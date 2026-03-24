import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorAlert } from './entities/sensor-alert.entity';
import { SensorStandby } from './entities/sensor-standby.entity';
import { Device } from '../devices/entities/device.entity';
import { SensorAlertsController } from './sensor-alerts.controller';
import { SensorAlertsService } from './sensor-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([SensorAlert, SensorStandby, Device])],
  controllers: [SensorAlertsController],
  providers: [SensorAlertsService],
})
export class SensorAlertsModule {}
