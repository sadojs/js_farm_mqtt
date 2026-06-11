import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 월 정산 (settlement). 요청→승인 워크플로우 + 박제(snapshot).
 * status: 'requested'(일꾼 확정 요청) | 'confirmed'(관리자 승인).
 * snapshot 에 당시 시급·공제·가불·실수령을 복사 → 이후 설정 변경에도 불변.
 */
@Entity('payroll_settlements')
@Index(['workerId', 'periodStart'], { unique: true })
export class WorkerSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'settle_date', type: 'date' })
  settleDate: string;

  /** 확정 시점 스냅샷 (총액/공제/가불/실수령 등 JSON) — 박제 */
  @Column({ name: 'snapshot', type: 'jsonb' })
  snapshot: Record<string, any>;

  @Column({ name: 'net_pay', type: 'int', default: 0 })
  netPay: number;

  /** 'requested' | 'confirmed' */
  @Column({ name: 'status', type: 'varchar', length: 12, default: 'requested' })
  status: string;

  @Column({ name: 'requested_at', type: 'timestamptz', nullable: true })
  requestedAt: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
