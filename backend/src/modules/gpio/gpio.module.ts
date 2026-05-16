import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttModule } from '../mqtt/mqtt.module';
import { GpioService } from './gpio.service';
import { GpioController } from './gpio.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Gateway]),
    MqttModule,
  ],
  providers: [GpioService],
  controllers: [GpioController],
})
export class GpioModule {}
