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
    // Acquire Redis lock to prevent race conditions
    const lockKey = `auction:lock:${auctionId}`;
    const lockAcquired = await this.redisService.setNX(lockKey, bidderId, 5);

    if (!lockAcquired) {
      throw new BadRequestException('Another bid is being processed. Please try again.');
    }

    try {
      const auction = await this.prisma.auction.findUnique({
        where: { id: auctionId },
      });

      if (!auction) {
        throw new NotFoundException('Auction not found');
      }

      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new BadRequestException('Auction is not active');
      }

      if (auction.endTime <= new Date()) {
        throw new BadRequestException('Auction has ended');
      }

      if (auction.sellerId === bidderId) {
        throw new ForbiddenException('You cannot bid on your own auction');
      }

      const minimumBid = Number(auction.currentPrice) + Number(auction.bidIncrement);
      if (dto.amount < minimumBid) {
        throw new BadRequestException(
          `Minimum bid is ${minimumBid}. Current price: ${auction.currentPrice}, increment: ${auction.bidIncrement}`,
        );
      }

      // Create bid and update auction atomically
      const [bid] = await this.prisma.$transaction([
        this.prisma.bid.create({
          data: {
            auctionId,
            bidderId,
            amount: dto.amount,
          },
          include: { bidder: { select: { id: true, firstName: true, lastName: true } } },
        }),
        this.prisma.auction.update({
          where: { id: auctionId },
          data: {
            currentPrice: dto.amount,
            totalBids: { increment: 1 },
          },
        }),
      ]);

      // Publish bid event via Redis for real-time updates
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

      return bid;
    } finally {
      // Release lock
      await this.redisService.del(lockKey);
    }
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

    // Publish auction end event
    await this.redisService.publish(
      `auction:${auctionId}:status`,
      JSON.stringify({
        status: 'ENDED',
        winnerId,
        finalPrice: auction.currentPrice,
      }),
    );

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
