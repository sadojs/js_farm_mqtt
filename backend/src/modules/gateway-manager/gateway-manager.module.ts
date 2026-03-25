import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gateway } from './entities/gateway.entity';
import { GatewayManagerService } from './gateway-manager.service';
import { GatewayManagerController } from './gateway-manager.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Gateway])],
  controllers: [GatewayManagerController],
  providers: [GatewayManagerService],
  exports: [GatewayManagerService],
})
export class GatewayManagerModule {}
