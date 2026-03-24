import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HarvestRecController } from './harvest-rec.controller';
import { HarvestRecService } from './harvest-rec.service';
import { HarvestTaskLog } from './entities/harvest-task-log.entity';
import { CropBatch } from '../harvest/entities/crop-batch.entity';
import { Device } from '../devices/entities/device.entity';

@Module({
  imports: [TypeOrmModule.forFeature([HarvestTaskLog, CropBatch, Device])],
  controllers: [HarvestRecController],
  providers: [HarvestRecService],
})
export class HarvestRecModule {}
