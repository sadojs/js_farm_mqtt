import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('automation_rules')
export class AutomationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id'  })
  userId: string;

  @Column({ name: 'group_id', nullable: true   })
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

  /** 정지 사유 — 'bulk'(일괄제어로 정지). 원복/수동 재활성화 시 null. */
  @Column({ name: 'disabled_reason', type: 'varchar', length: 20, nullable: true })
  disabledReason: string | null;

  /** 정지 시각 (disabled_reason 세팅 시각) */
  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
