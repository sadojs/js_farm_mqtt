import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SshProxyService } from './ssh-proxy.service';
import { SshProxyGateway } from './ssh-proxy.gateway';
import { GatewayManagerModule } from '../gateway-manager/gateway-manager.module';

@Module({
  imports: [
    forwardRef(() => GatewayManagerModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get('JWT_SECRET'),
      }),
    }),
  ],
  providers: [SshProxyService, SshProxyGateway],
  exports: [SshProxyService],
})
export class SshProxyModule {}
