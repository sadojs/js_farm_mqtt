import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('automation_rules')
export class AutomationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'group_id', nullable: true })
  groupId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'rule_type' })
  ruleType: 'weather' | 'time' | 'hybrid';

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'jsonb' })
  conditions: any;

  @Column({ type: 'jsonb' })
  actions: any;

  @Column({ default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
