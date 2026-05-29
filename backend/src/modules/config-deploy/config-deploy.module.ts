import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigDeployController } from './config-deploy.controller';
import { ConfigDeployService } from './config-deploy.service';
import { GatewayManagerModule } from '../gateway-manager/gateway-manager.module';
import { SshProxyModule } from '../ssh-proxy/ssh-proxy.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { Gateway } from '../gateway-manager/entities/gateway.entity';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => GatewayManagerModule),
    SshProxyModule,
    forwardRef(() => MqttModule),
    GatewayModule,
    ActivityLogModule,
    TypeOrmModule.forFeature([Gateway]),
  ],
  controllers: [ConfigDeployController],
  providers: [ConfigDeployService],
  exports: [ConfigDeployService],
})
export class ConfigDeployModule {}
