import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { Device } from './entities/device.entity';
import { TuyaProject } from '../users/entities/tuya-project.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';
import { TuyaModule } from '../integrations/tuya/tuya.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, TuyaProject, AutomationRule]),
    TuyaModule,
    GatewayModule,
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
