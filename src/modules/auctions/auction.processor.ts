import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AuctionsService } from './auctions.service';
import { PrismaService } from '../../database/prisma.service';
import { AuctionStatus } from '@prisma/client';

@Processor('auctions')
export class AuctionProcessor {
  private readonly logger = new Logger(AuctionProcessor.name);

  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('start-auction')
  async handleStartAuction(job: Job<{ auctionId: string }>) {
    const { auctionId } = job.data;
    this.logger.log(`Starting auction: ${auctionId}`);

    await this.prisma.auction.update({
      where: { id: auctionId },
      data: { status: AuctionStatus.ACTIVE },
    });
  }

  @Process('end-auction')
  async handleEndAuction(job: Job<{ auctionId: string }>) {
    const { auctionId } = job.data;
    this.logger.log(`Ending auction: ${auctionId}`);

    await this.auctionsService.endAuction(auctionId);
  }
}
