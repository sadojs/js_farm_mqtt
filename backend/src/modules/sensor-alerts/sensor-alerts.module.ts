import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SensorAlert } from './entities/sensor-alert.entity';
import { SensorStandby } from './entities/sensor-standby.entity';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { SensorAlertsController } from './sensor-alerts.controller';
import { SensorAlertsService } from './sensor-alerts.service';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SensorAlert, SensorStandby, Device, Gateway]),
    GatewayModule,       // EventsGateway — 실시간 웹소켓 알림
    NotificationsModule, // NotificationsService — 모바일 푸시(FCM/APNs)
  ],
  controllers: [SensorAlertsController],
  providers: [SensorAlertsService],
  exports: [SensorAlertsService],
})
export class SensorAlertsModule {}
