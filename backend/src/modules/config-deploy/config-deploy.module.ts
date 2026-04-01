import { Module, forwardRef } from '@nestjs/common';
import { ConfigDeployController } from './config-deploy.controller';
import { ConfigDeployService } from './config-deploy.service';
import { GatewayManagerModule } from '../gateway-manager/gateway-manager.module';

@Module({
  imports: [
    forwardRef(() => GatewayManagerModule),
  ],
  controllers: [ConfigDeployController],
  providers: [ConfigDeployService],
  exports: [ConfigDeployService],
})
export class ConfigDeployModule {}
