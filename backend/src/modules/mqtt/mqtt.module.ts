import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MqttService } from './mqtt.service';
import { MqttSensorHandler } from './mqtt-sensor.handler';
import { MqttDeviceHandler } from './mqtt-device.handler';
import { MqttBridgeHandler } from './mqtt-bridge.handler';
import { Device } from '../devices/entities/device.entity';
import { SensorsModule } from '../sensors/sensors.module';
import { GatewayManagerModule } from '../gateway-manager/gateway-manager.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Device]),
    SensorsModule,
    GatewayManagerModule,
    GatewayModule,
  ],
  providers: [MqttService, MqttSensorHandler, MqttDeviceHandler, MqttBridgeHandler],
  exports: [MqttService],
})
export class MqttModule {}
