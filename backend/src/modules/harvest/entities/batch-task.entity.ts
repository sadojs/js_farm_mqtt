import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('batch_tasks')
export class BatchTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @Column({ name: 'anchor_date', type: 'date' })
  anchorDate: string;

  @Column({ name: 'reschedule_mode', default: 'anchor' })
  rescheduleMode: 'anchor' | 'shift' | 'one_time';

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
