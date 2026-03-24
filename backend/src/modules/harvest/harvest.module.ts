import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CropBatch } from './entities/crop-batch.entity';
import { TaskTemplate } from './entities/task-template.entity';
import { BatchTask } from './entities/batch-task.entity';
import { TaskOccurrence } from './entities/task-occurrence.entity';
import { HarvestController } from './harvest.controller';
import { HarvestTaskController } from './harvest-task.controller';
import { HarvestService } from './harvest.service';
import { HarvestTaskService } from './harvest-task.service';

@Module({
  imports: [TypeOrmModule.forFeature([CropBatch, TaskTemplate, BatchTask, TaskOccurrence])],
  controllers: [HarvestController, HarvestTaskController],
  providers: [HarvestService, HarvestTaskService],
})
export class HarvestModule {}
