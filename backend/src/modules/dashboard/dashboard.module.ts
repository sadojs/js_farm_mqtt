import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { User } from '../users/entities/user.entity';
import { Device } from '../devices/entities/device.entity';
import { SensorData } from '../sensors/entities/sensor-data.entity';
import { WeatherData } from '../weather/weather-data.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Device, SensorData, WeatherData])],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
