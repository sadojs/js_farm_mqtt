import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DevicesModule } from './modules/devices/devices.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SensorsModule } from './modules/sensors/sensors.module';
import { AutomationModule } from './modules/automation/automation.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { GatewayManagerModule } from './modules/gateway-manager/gateway-manager.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WeatherModule } from './modules/weather/weather.module';
import { SensorAlertsModule } from './modules/sensor-alerts/sensor-alerts.module';
import { EnvConfigModule } from './modules/env-config/env-config.module';
import { ConfigDeployModule } from './modules/config-deploy/config-deploy.module';
import { HealthModule } from './modules/health/health.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CropManagementModule } from './modules/crop-management/crop-management.module';
import { SshProxyModule } from './modules/ssh-proxy/ssh-proxy.module';
import { GatewayEnvModule } from './modules/gateway-env/gateway-env.module';
import { GpioModule } from './modules/gpio/gpio.module';
import { RainOverrideModule } from './modules/rain-override/rain-override.module';
import { FallbackConfigModule } from './modules/fallback-config/fallback-config.module';
import { RetentionService } from './common/retention.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
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
    MqttModule,
    GatewayManagerModule,
    DashboardModule,
    WeatherModule,
    SensorAlertsModule,
    EnvConfigModule,
    ConfigDeployModule,
    HealthModule,
    ActivityLogModule,
    VoiceModule,
    CropManagementModule,
    SshProxyModule,
    GatewayEnvModule,
    GpioModule,
    RainOverrideModule,
    FallbackConfigModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    RetentionService,
  ],
})
export class AppModule {}
