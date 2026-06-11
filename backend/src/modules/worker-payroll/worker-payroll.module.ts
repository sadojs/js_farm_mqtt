import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Worker } from './entities/worker.entity';
import { WorkerDeduction } from './entities/worker-deduction.entity';
import { WorkerAdvance } from './entities/worker-advance.entity';
import { WorkerDayOverride } from './entities/worker-day-override.entity';
import { WorkerSettlement } from './entities/worker-settlement.entity';
import { WorkerPayrollService } from './worker-payroll.service';
import { WorkerPayrollController } from './worker-payroll.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Worker,
      WorkerDeduction,
      WorkerAdvance,
      WorkerDayOverride,
      WorkerSettlement,
    ]),
    UsersModule,
  ],
  controllers: [WorkerPayrollController],
  providers: [WorkerPayrollService],
})
export class WorkerPayrollModule {}
