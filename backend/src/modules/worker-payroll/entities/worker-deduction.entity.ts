import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 매월 기본 공제 항목 (예: 숙소비, 식대) */
@Entity('payroll_deductions')
export class WorkerDeduction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  /** 소속 시즌 — 시즌별 공제. NULL 은 시즌 도입 전 행(조회 시 지연 백필로 연결됨) */
  @Column({ name: 'season_id', type: 'uuid', nullable: true })
  seasonId: string | null;

  @Column({ name: 'label', type: 'varchar', length: 60 })
  label: string;

  /** 'fixed'(고정·매달 동일) | 'variable'(변동·정산월마다 금액 입력) */
  @Column({ name: 'kind', type: 'varchar', length: 10, default: 'fixed' })
  kind: string;

  /** 고정 공제 금액. 변동 공제는 0(정산 시 입력값 사용). */
  @Column({ name: 'amount', type: 'int', default: 0 })
  amount: number;

  /** 일할 계산 적용 여부 — 고정공제만 의미. 변동공제는 무시. */
  @Column({ name: 'prorate', type: 'boolean', default: true })
  prorate: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
