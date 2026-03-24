import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { HouseGroup } from './entities/house-group.entity';
import { House } from './entities/house.entity';
import { Device } from '../devices/entities/device.entity';
import { AutomationRule } from '../automation/entities/automation-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HouseGroup, House, Device, AutomationRule])],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
