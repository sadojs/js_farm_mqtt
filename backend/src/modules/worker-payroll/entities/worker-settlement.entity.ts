import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 월 정산 확정 기록 (주기 마감) */
@Entity('payroll_settlements')
@Index(['workerId', 'periodStart'], { unique: true })
export class WorkerSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  /** 정산 주기 시작일 (근무시작일 기준) */
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  /** 정산 주기 종료일 (포함) */
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  /** 마감일 (= period_end + 1일) */
  @Column({ name: 'settle_date', type: 'date' })
  settleDate: string;

  /** 확정 시점 스냅샷 (총액/공제/가불/실수령 등 JSON) */
  @Column({ name: 'snapshot', type: 'jsonb' })
  snapshot: Record<string, any>;

  @Column({ name: 'net_pay', type: 'int', default: 0 })
  netPay: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
