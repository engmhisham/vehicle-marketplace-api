import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesCronService } from './vehicles-cron.service';
import { VehiclesCleanupService } from './vehicles-cleanup.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesCronService, VehiclesCleanupService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
