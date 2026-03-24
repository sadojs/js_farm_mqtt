import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('harvest_task_logs')
export class HarvestTaskLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'task_type', type: 'varchar', length: 30 })
  taskType: string;

  @Column({ name: 'completed_at', type: 'timestamptz', default: () => 'NOW()' })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
