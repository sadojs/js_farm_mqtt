import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('crop_milestones')
export class CropMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'crop_type', length: 30 })
  cropType: string;

  @Column({ name: 'seedling_type', type: 'varchar', length: 20, nullable: true })
  seedlingType: string | null;

  @Column({ name: 'milestone_type', length: 30 })
  milestoneType: string;

  @Column({ name: 'gdd_threshold', type: 'decimal', precision: 7, scale: 1 })
  gddThreshold: number;

  @Column({ length: 100 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 10, default: 'normal' })
  priority: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
