import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { GatewayManagerModule } from '../gateway-manager/gateway-manager.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), GatewayManagerModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
