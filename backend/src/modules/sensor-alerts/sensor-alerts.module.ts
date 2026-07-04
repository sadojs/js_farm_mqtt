import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorAlert } from './entities/sensor-alert.entity';
import { SensorStandby } from './entities/sensor-standby.entity';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { SensorAlertsController } from './sensor-alerts.controller';
import { SensorAlertsService } from './sensor-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([SensorAlert, SensorStandby, Device, Gateway])],
  controllers: [SensorAlertsController],
  providers: [SensorAlertsService],
  exports: [SensorAlertsService],
})
export class SensorAlertsModule {}
