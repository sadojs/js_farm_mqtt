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

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, AutomationRule, Gateway, GatewayOnboardDevice]),
    MqttModule,
    GatewayModule,
    ActivityLogModule,
    forwardRef(() => RainOverrideModule),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
