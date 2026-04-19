import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('gdd_batches')
export class CropBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ name: 'crop_type', length: 30 })
  cropType: string;

  @Column({ name: 'seedling_type', length: 20 })
  seedlingType: string;

  @Column({ name: 'sowing_date', type: 'date' })
  sowingDate: string;

  @Column({ name: 'transplant_date', type: 'date', nullable: true })
  transplantDate: string | null;

  @Column({ name: 'base_temp', type: 'decimal', precision: 4, scale: 1, default: 10.0 })
  baseTemp: number;

  @Column({ name: 'target_gdd', type: 'decimal', precision: 7, scale: 1, nullable: true })
  targetGdd: number | null;

  @Column({ name: 'temp_source', length: 20, default: 'auto' })
  tempSource: string;

  @Column({ name: 'greenhouse_offset', type: 'decimal', precision: 4, scale: 1, nullable: true })
  greenhouseOffset: number | null;

  @Column({ name: 'offset_source', type: 'varchar', length: 20, nullable: true })
  offsetSource: string | null;

  @Column({ name: 'borrowed_group_id', type: 'uuid', nullable: true })
  borrowedGroupId: string | null;

  @Column({ name: 'offset_calibrated_at', type: 'timestamptz', nullable: true })
  offsetCalibratedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
