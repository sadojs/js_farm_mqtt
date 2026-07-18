import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FallbackConfig } from './entities/fallback-config.entity';
import { FallbackOpenerSchedule } from './entities/fallback-opener-schedule.entity';
import { FallbackEvent } from './entities/fallback-event.entity';
import { FallbackGatewayStatus } from './entities/fallback-gateway-status.entity';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';
import { FallbackConfigService } from './fallback-config.service';
import { FallbackConfigController } from './fallback-config.controller';
import { HeartbeatService } from './heartbeat.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { GatewayModule } from '../gateway/gateway.module';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { Device } from '../devices/entities/device.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FallbackConfig,
      FallbackOpenerSchedule,
      FallbackEvent,
      FallbackGatewayStatus,
      Gateway,
      GatewayOnboardDevice,
      AutomationRule,
      Device,
    ]),
    forwardRef(() => MqttModule),
    GatewayModule,
  ],
  controllers: [FallbackConfigController],
  providers: [FallbackConfigService, HeartbeatService],
  exports: [FallbackConfigService],
})
export class FallbackConfigModule {}
