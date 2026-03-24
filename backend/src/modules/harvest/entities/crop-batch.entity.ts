import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('crop_batches')
export class CropBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'crop_name' })
  cropName: string;

  @Column({ nullable: true })
  variety: string;

  @Column({ name: 'house_name' })
  houseName: string;

  @Column({ name: 'house_id', type: 'uuid', nullable: true })
  houseId: string;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string;

  @Column({ name: 'sow_date', type: 'date' })
  sowDate: string;

  @Column({ name: 'transplant_date', type: 'date', nullable: true })
  transplantDate: string;

  @Column({ name: 'grow_days', type: 'int' })
  growDays: number;

  @Column({ default: 'vegetative' })
  stage: string;

  @Column({ name: 'current_stage', default: 'vegetative' })
  currentStage: string;

  @Column({ name: 'stage_started_at', type: 'timestamptz', nullable: true })
  stageStartedAt: Date;

  @Column({ type: 'text', nullable: true })
  memo: string;

  @Column({ default: 'active' })
  status: 'active' | 'completed';

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
