import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('task_occurrences')
export class TaskOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_task_id', type: 'uuid' })
  batchTaskId: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'scheduled_date', type: 'date' })
  scheduledDate: string;

  @Column({ default: 'planned' })
  status: 'planned' | 'done' | 'skipped';

  @Column({ name: 'done_date', type: 'date', nullable: true })
  doneDate: string;

  @Column({ name: 'window_end_date', type: 'date', nullable: true })
  windowEndDate: string;

  @Column({ name: 'growth_feedback', nullable: true })
  growthFeedback: string;

  @Column({ type: 'text', nullable: true })
  memo: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
