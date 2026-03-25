import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorsService } from './sensors.service';
import { SensorsController } from './sensors.controller';
import { SensorCollectorService } from './sensor-collector.service';
import { SensorData } from './entities/sensor-data.entity';
import { Device } from '../devices/entities/device.entity';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SensorData, Device]),
    GatewayModule,
  ],
  controllers: [SensorsController],
  providers: [SensorsService, SensorCollectorService],
  exports: [SensorsService],
})
export class SensorsModule {}
