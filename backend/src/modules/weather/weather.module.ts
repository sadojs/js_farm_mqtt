import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeatherData } from './weather-data.entity';
import { WeatherCollectorService } from './weather-collector.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeatherData, User]),
    DashboardModule,
  ],
  providers: [WeatherCollectorService],
  exports: [TypeOrmModule],
})
export class WeatherModule {}
