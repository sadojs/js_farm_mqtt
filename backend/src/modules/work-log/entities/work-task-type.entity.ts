import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('work_task_types')
export class WorkTaskType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  @Column({ type: 'varchar', length: 16, default: '#43a047' })
  color: string;

  @Column({ type: 'varchar', length: 8, default: '🍃' })
  emoji: string;

  @Column({ name: 'icon_key', type: 'varchar', length: 40, nullable: true })
  iconKey: string | null;

  @Column({ name: 'is_standard', default: false })
  isStandard: boolean;

  @Column({ default: false })
  hidden: boolean;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
