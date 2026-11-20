import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { Device } from './entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';
import { MqttModule } from '../mqtt/mqtt.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { RainOverrideModule } from '../rain-override/rain-override.module';
import { AutomationModule } from '../automation/automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommandAckService } from './command-ack.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, AutomationRule, Gateway, GatewayOnboardDevice]),
    MqttModule,
    GatewayModule,
    ActivityLogModule,
    forwardRef(() => RainOverrideModule),
    forwardRef(() => AutomationModule),
    NotificationsModule,
  ],
  controllers: [DevicesController],
  providers: [DevicesService, CommandAckService],
  exports: [DevicesService, CommandAckService],
})
export class DevicesModule {}
