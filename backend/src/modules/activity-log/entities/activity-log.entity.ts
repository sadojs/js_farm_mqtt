import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'user_name' })
  userName: string;

  @Column({ name: 'group_id', nullable: true })
  groupId: string;

  @Column({ name: 'group_name', nullable: true })
  groupName: string;

  @Column()
  action: string;

  @Column({ name: 'target_type' })
  targetType: string;

  @Column({ name: 'target_id', nullable: true })
  targetId: string;

  @Column({ name: 'target_name', nullable: true })
  targetName: string;

  @Column({ type: 'jsonb', nullable: true })
  details: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
