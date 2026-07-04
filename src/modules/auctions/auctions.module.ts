import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionProcessor } from './auction.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'auctions',
    }),
  ],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsGateway, AuctionProcessor],
  exports: [AuctionsService],
})
export class AuctionsModule {}
