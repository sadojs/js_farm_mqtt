import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { AutomationRule } from './entities/automation-rule.entity';
import { AutomationLog } from './entities/automation-log.entity';
import { AutomationRunnerService } from './automation-runner.service';
import { IrrigationSchedulerService } from './irrigation-scheduler.service';
import { Device } from '../devices/entities/device.entity';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttModule } from '../mqtt/mqtt.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AutomationRule, AutomationLog, Device, Gateway]),
    MqttModule,
    GatewayModule,
  ],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationRunnerService, IrrigationSchedulerService],
  exports: [AutomationService],
})
export class AutomationModule {}
