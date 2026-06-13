import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkTaskType } from './entities/work-task-type.entity';
import { WorkLog } from './entities/work-log.entity';
import { WorkLogService } from './work-log.service';
import { WorkLogController } from './work-log.controller';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WorkTaskType, WorkLog, HouseGroup, User])],
  controllers: [WorkLogController],
  providers: [WorkLogService],
  exports: [WorkLogService],
})
export class WorkLogModule {}
