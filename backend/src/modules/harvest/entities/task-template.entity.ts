import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('task_templates')
export class TaskTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'task_name' })
  taskName: string;

  @Column({ name: 'crop_type', default: 'cherry_tomato' })
  cropType: string;

  @Column({ name: 'stage_name', type: 'varchar', nullable: true })
  stageName: string | null;

  @Column({ name: 'interval_days', type: 'int' })
  intervalDays: number;

  @Column({ name: 'interval_min_days', type: 'int', nullable: true })
  intervalMinDays: number | null;

  @Column({ name: 'interval_max_days', type: 'int', nullable: true })
  intervalMaxDays: number | null;

  @Column({ name: 'start_offset_days', type: 'int', default: 0 })
  startOffsetDays: number;

  @Column({ name: 'default_reschedule_mode', default: 'anchor' })
  defaultRescheduleMode: 'anchor' | 'shift' | 'one_time';

  @Column({ name: 'is_preset', default: false })
  isPreset: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
