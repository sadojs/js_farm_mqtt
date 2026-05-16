import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayOnboardDevice } from './entities/gateway-onboard-device.entity';
import { GatewayEnvService } from './gateway-env.service';
import { GatewayEnvController } from './gateway-env.controller';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { Device } from '../devices/entities/device.entity';
import { MqttModule } from '../mqtt/mqtt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GatewayOnboardDevice, Gateway, Device]),
    MqttModule,
  ],
  providers: [GatewayEnvService],
  controllers: [GatewayEnvController],
  exports: [GatewayEnvService],
})
export class GatewayEnvModule {}
