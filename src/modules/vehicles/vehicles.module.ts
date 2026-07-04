import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehiclesCronService } from './vehicles-cron.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesCronService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
