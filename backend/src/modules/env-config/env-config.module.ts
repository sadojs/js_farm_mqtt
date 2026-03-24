import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvRole } from './entities/env-role.entity';
import { EnvMapping } from './entities/env-mapping.entity';
import { EnvConfigController } from './env-config.controller';
import { EnvConfigService } from './env-config.service';
import { Device } from '../devices/entities/device.entity';
import { WeatherData } from '../weather/weather-data.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EnvRole, EnvMapping, Device, WeatherData, HouseGroup])],
  controllers: [EnvConfigController],
  providers: [EnvConfigService],
  exports: [EnvConfigService],
})
export class EnvConfigModule {}
