import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { AutomationModule } from '../automation/automation.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { SensorAlertsModule } from '../sensor-alerts/sensor-alerts.module';
import { SprayScheduleModule } from '../spray-schedule/spray-schedule.module';
import { WorkLogModule } from '../work-log/work-log.module';
import { GroupsModule } from '../groups/groups.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { MidForecastService } from './mid-forecast.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), UsersModule, DevicesModule, AutomationModule, DashboardModule, SensorAlertsModule, SprayScheduleModule, WorkLogModule, GroupsModule],
  controllers: [VoiceController],
  providers: [VoiceService, MidForecastService],
})
export class VoiceModule {}
