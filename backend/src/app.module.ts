import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DevicesModule } from './modules/devices/devices.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SensorsModule } from './modules/sensors/sensors.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { TuyaModule } from './modules/integrations/tuya/tuya.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WeatherModule } from './modules/weather/weather.module';
import { HarvestModule } from './modules/harvest/harvest.module';
import { SensorAlertsModule } from './modules/sensor-alerts/sensor-alerts.module';
import { HarvestRecModule } from './modules/harvest-rec/harvest-rec.module';
import { EnvConfigModule } from './modules/env-config/env-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', 'postgresql://smartfarm:smartfarm123@localhost:5432/smartfarm'),
        autoLoadEntities: true,
        synchronize: false, // 스키마는 schema.sql로 관리
      }),
    }),
    AuthModule,
    UsersModule,
    DevicesModule,
    GroupsModule,
    SensorsModule,
    AutomationModule,
    ReportsModule,
    GatewayModule,
    TuyaModule,
    DashboardModule,
    WeatherModule,
    HarvestModule,
    SensorAlertsModule,
    HarvestRecModule,
    EnvConfigModule,
  ],
})
export class AppModule {}
