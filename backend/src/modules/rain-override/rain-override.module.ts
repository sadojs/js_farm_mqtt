import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { EnvMapping } from '../env-config/entities/env-mapping.entity';
import { RainOverrideService } from './rain-override.service';
import { GatewayModule } from '../gateway/gateway.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, EnvMapping]),
    GatewayModule,
    ActivityLogModule,
    forwardRef(() => DevicesModule),
  ],
  providers: [RainOverrideService],
  exports: [RainOverrideService],
})
export class RainOverrideModule {}
