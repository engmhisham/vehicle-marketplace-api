import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VehiclesService } from './vehicles.service';

@Injectable()
export class VehiclesCronService {
  private readonly logger = new Logger(VehiclesCronService.name);

  constructor(private readonly vehiclesService: VehiclesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async flushViewCounts() {
    try {
      await this.vehiclesService.flushViewCounts();
    } catch (error) {
      this.logger.error('Failed to flush view counts', error);
    }
  }
}
