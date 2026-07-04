import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AuctionStatus, VehicleStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @InjectQueue('auctions') private readonly auctionQueue: Queue,
  ) {}

  async create(sellerId: string, dto: CreateAuctionDto) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== sellerId) {
      throw new ForbiddenException('You can only auction your own vehicles');
    }

    if (vehicle.status !== VehicleStatus.PUBLISHED) {
      throw new BadRequestException('Vehicle must be published before auctioning');
    }

    const existingAuction = await this.prisma.auction.findUnique({
      where: { vehicleId: dto.vehicleId },
    });

    if (
      existingAuction &&
      existingAuction.status !== AuctionStatus.ENDED &&
      existingAuction.status !== AuctionStatus.CANCELLED
    ) {
      throw new BadRequestException('Vehicle already has an active auction');
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const auction = await this.prisma.auction.create({
      data: {
        vehicleId: dto.vehicleId,
        sellerId,
        startingPrice: dto.startingPrice,
        currentPrice: dto.startingPrice,
        bidIncrement: dto.bidIncrement,
        startTime,
        endTime,
        status: startTime <= new Date() ? AuctionStatus.ACTIVE : AuctionStatus.SCHEDULED,
      },
      include: { vehicle: true },
    });

    // Update vehicle status
    await this.prisma.vehicle.update({
      where: { id: dto.vehicleId },
      data: { status: VehicleStatus.IN_AUCTION },
    });

    // Schedule auction start if in future
    if (startTime > new Date()) {
      await this.auctionQueue.add(
        'start-auction',
        { auctionId: auction.id },
        { delay: startTime.getTime() - Date.now() },
      );
    }

    // Schedule auction end
    await this.auctionQueue.add(
      'end-auction',
      { auctionId: auction.id },
      { delay: endTime.getTime() - Date.now() },
    );

    return auction;
  }

  async findAll(pagination: PaginationDto, status?: AuctionStatus) {
    const where = status ? { status } : { status: AuctionStatus.ACTIVE };

    const [auctions, total] = await Promise.all([
      this.prisma.auction.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { endTime: 'asc' },
        include: {
          vehicle: {
            include: { images: { where: { isPrimary: true }, take: 1 } },
          },
          seller: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.auction.count({ where }),
    ]);

    return paginate(auctions, total, pagination.page, pagination.limit);
  }

  async findOne(id: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id },
      include: {
        vehicle: { include: { images: true } },
        seller: { select: { id: true, firstName: true, lastName: true } },
        winner: { select: { id: true, firstName: true, lastName: true } },
        bids: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { bidder: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    return auction;
  }

  async placeBid(auctionId: string, bidderId: string, dto: PlaceBidDto) {
    // Use PostgreSQL SELECT FOR UPDATE inside a serializable transaction
    // This is safer than Redis locks which can expire under heavy load
    const bid = await this.prisma.$transaction(async (tx) => {
      // Lock the auction row - blocks concurrent bids until this transaction completes
      const [auction] = await tx.$queryRaw<any[]>`
        SELECT * FROM auctions WHERE id = ${auctionId} FOR UPDATE
      `;

      if (!auction) {
        throw new NotFoundException('Auction not found');
      }

      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new BadRequestException('Auction is not active');
      }

      if (new Date(auction.end_time) <= new Date()) {
        throw new BadRequestException('Auction has ended');
      }

      if (auction.seller_id === bidderId) {
        throw new ForbiddenException('You cannot bid on your own auction');
      }

      const currentPrice = Number(auction.current_price);
      const bidIncrement = Number(auction.bid_increment);
      const minimumBid = currentPrice + bidIncrement;

      if (dto.amount < minimumBid) {
        throw new BadRequestException(
          `Minimum bid is ${minimumBid}. Current price: ${currentPrice}, increment: ${bidIncrement}`,
        );
      }

      // === BID HOLD PATTERN ===
      // 1. Check bidder has sufficient wallet balance
      const bidderWallet = await tx.wallet.findUnique({ where: { userId: bidderId } });
      if (!bidderWallet || Number(bidderWallet.balance) < dto.amount) {
        throw new BadRequestException('Insufficient wallet balance to place this bid');
      }

      // 2. Hold the bid amount from bidder's wallet
      await tx.wallet.update({
        where: { id: bidderWallet.id },
        data: { balance: { decrement: dto.amount } },
      });
      await tx.transaction.create({
        data: {
          walletId: bidderWallet.id,
          type: 'BID_HOLD',
          amount: -dto.amount,
          balance: Number(bidderWallet.balance) - dto.amount,
          status: 'COMPLETED',
          referenceId: auctionId,
          referenceType: 'auction_bid_hold',
          description: `Bid hold for auction`,
        },
      });

      // 3. Release hold from previous top bidder (if any)
      const previousTopBid = await tx.bid.findFirst({
        where: { auctionId },
        orderBy: { amount: 'desc' },
      });
      if (previousTopBid && previousTopBid.bidderId !== bidderId) {
        const prevWallet = await tx.wallet.findUnique({
          where: { userId: previousTopBid.bidderId },
        });
        if (prevWallet) {
          await tx.wallet.update({
            where: { id: prevWallet.id },
            data: { balance: { increment: Number(previousTopBid.amount) } },
          });
          await tx.transaction.create({
            data: {
              walletId: prevWallet.id,
              type: 'BID_RELEASE',
              amount: Number(previousTopBid.amount),
              balance: Number(prevWallet.balance) + Number(previousTopBid.amount),
              status: 'COMPLETED',
              referenceId: auctionId,
              referenceType: 'auction_bid_release',
              description: `Bid released - outbid on auction`,
            },
          });
        }
      }

      // 4. Create bid record
      const newBid = await tx.bid.create({
        data: {
          auctionId,
          bidderId,
          amount: dto.amount,
        },
        include: { bidder: { select: { id: true, firstName: true, lastName: true } } },
      });

      // 5. Update auction price
      await tx.auction.update({
        where: { id: auctionId },
        data: {
          currentPrice: dto.amount,
          totalBids: { increment: 1 },
        },
      });

      return newBid;
    });

    // Publish bid event via Redis for real-time updates (non-blocking, outside transaction)
    try {
      await this.redisService.publish(
        `auction:${auctionId}:bids`,
        JSON.stringify({
          bidId: bid.id,
          auctionId,
          bidderId,
          bidderName: `${bid.bidder.firstName || ''} ${bid.bidder.lastName || ''}`.trim(),
          amount: dto.amount,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to publish bid event for auction ${auctionId}`, error);
    }

    return bid;
  }

  async getBidHistory(auctionId: string, pagination: PaginationDto) {
    const [bids, total] = await Promise.all([
      this.prisma.bid.findMany({
        where: { auctionId },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: { bidder: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.bid.count({ where: { auctionId } }),
    ]);

    return paginate(bids, total, pagination.page, pagination.limit);
  }

  async endAuction(auctionId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
    });

    if (!auction || auction.status !== AuctionStatus.ACTIVE) {
      return;
    }

    const winnerId = auction.bids.length > 0 ? auction.bids[0].bidderId : null;

    await this.prisma.$transaction([
      this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          status: AuctionStatus.ENDED,
          winnerId,
        },
      }),
      this.prisma.vehicle.update({
        where: { id: auction.vehicleId },
        data: { status: winnerId ? VehicleStatus.SOLD : VehicleStatus.PUBLISHED },
      }),
    ]);

    // Publish auction end event (non-blocking)
    try {
      await this.redisService.publish(
        `auction:${auctionId}:status`,
        JSON.stringify({
          status: 'ENDED',
          winnerId,
          finalPrice: auction.currentPrice,
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to publish auction end event for ${auctionId}`, error);
    }

    this.logger.log(`Auction ${auctionId} ended. Winner: ${winnerId || 'none'}`);
  }

  async cancelAuction(auctionId: string, userId: string, userRole: string) {
    const auction = await this.prisma.auction.findUnique({ where: { id: auctionId } });

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    if (auction.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only cancel your own auctions');
    }

    if (auction.status === AuctionStatus.ENDED) {
      throw new BadRequestException('Cannot cancel an ended auction');
    }

    await this.prisma.$transaction([
      this.prisma.auction.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.CANCELLED },
      }),
      this.prisma.vehicle.update({
        where: { id: auction.vehicleId },
        data: { status: VehicleStatus.PUBLISHED },
      }),
    ]);

    return { message: 'Auction cancelled successfully' };
  }
}
