import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CropBatch } from './entities/crop-batch.entity';
import { CropMilestone } from './entities/crop-milestone.entity';
import { CropBatchService } from './crop-batch.service';
import { GddService } from './gdd.service';
import { KmaClimateService } from './kma-climate.service';
import { CropManagementController } from './crop-management.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CropBatch, CropMilestone])],
  controllers: [CropManagementController],
  providers: [CropBatchService, GddService, KmaClimateService],
})
export class CropManagementModule {}
