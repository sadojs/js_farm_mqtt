import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'smart-farm-jwt-secret-change-me'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    TypeOrmModule.forFeature([House, HouseGroup]),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class GatewayModule {}
