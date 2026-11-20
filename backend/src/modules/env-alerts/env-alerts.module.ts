import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvAlertSetting } from './env-alert-setting.entity';
import { EnvAlertsService } from './env-alerts.service';
import { EnvAlertsController } from './env-alerts.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([EnvAlertSetting]), GatewayModule, NotificationsModule],
  controllers: [EnvAlertsController],
  providers: [EnvAlertsService],
  exports: [EnvAlertsService],
})
export class EnvAlertsModule {}
