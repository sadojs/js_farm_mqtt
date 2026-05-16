import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gateway } from './entities/gateway.entity';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { GatewayManagerService } from './gateway-manager.service';
import { GatewayManagerController } from './gateway-manager.controller';
import { TunnelSetupController } from './tunnel-setup.controller';
import { MqttModule } from '../mqtt/mqtt.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gateway, House, HouseGroup]),
    forwardRef(() => MqttModule),
    GatewayModule,
  ],
  controllers: [GatewayManagerController, TunnelSetupController],
  providers: [GatewayManagerService],
  exports: [GatewayManagerService],
})
export class GatewayManagerModule {}
