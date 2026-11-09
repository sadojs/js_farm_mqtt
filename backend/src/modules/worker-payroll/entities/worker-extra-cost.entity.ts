import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 기타 고용비용 (항공권·비자 등) — 연간 결산의 총 고용비용에 합산 */
@Entity('payroll_extra_costs')
@Index(['userId', 'year'])
export class WorkerExtraCost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 농장 소유자(farm_admin) user id */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 귀속 연도 (date 가 있으면 그 연도) */
  @Column({ name: 'year', type: 'int' })
  year: number;

  @Column({ name: 'date', type: 'date', nullable: true })
  date: string | null;

  /** 특정 일꾼 비용이면 지정 (선택) */
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  workerId: string | null;

  @Column({ name: 'label', type: 'varchar', length: 60 })
  label: string;

  @Column({ name: 'amount', type: 'int', default: 0 })
  amount: number;

  @Column({ name: 'note', type: 'varchar', length: 120, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
