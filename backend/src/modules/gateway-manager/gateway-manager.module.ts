import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gateway } from './entities/gateway.entity';
import { GatewayManagerService } from './gateway-manager.service';
import { GatewayManagerController } from './gateway-manager.controller';
import { MqttModule } from '../mqtt/mqtt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gateway]),
    forwardRef(() => MqttModule),
  ],
  controllers: [GatewayManagerController],
  providers: [GatewayManagerService],
  exports: [GatewayManagerService],
})
export class GatewayManagerModule {}
