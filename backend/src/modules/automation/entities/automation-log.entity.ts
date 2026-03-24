import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('automation_logs')
export class AutomationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rule_id' })
  ruleId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @CreateDateColumn({ name: 'executed_at' })
  executedAt: Date;

  @Column()
  success: boolean;

  @Column({ name: 'conditions_met', type: 'jsonb', nullable: true })
  conditionsMet: any;

  @Column({ name: 'actions_executed', type: 'jsonb', nullable: true })
  actionsExecuted: any;

  @Column({ name: 'error_message', nullable: true })
  errorMessage: string;
}
