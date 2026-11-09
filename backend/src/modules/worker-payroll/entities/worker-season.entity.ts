import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 일꾼 시즌 (한 번의 고용 기간). 근무조건(기간·임금·정산주기·기본시간)과 공제는 시즌이 가진다.
 * payroll_workers 의 같은 이름 컬럼은 "현재 시즌 미러"(구버전 앱 호환).
 * closed_at 이 있으면 마감 — 이 시즌 날짜의 달력·가불·정산·공제 수정 불가.
 */
@Entity('payroll_worker_seasons')
@Index(['workerId', 'startDate'])
export class WorkerSeason {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 농장 소유자(farm_admin) user id */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  /** 표시용 연도 = start_date 의 연도 */
  @Column({ name: 'season_year', type: 'int' })
  seasonYear: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** NULL = 근무 중 */
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'salary_type', type: 'varchar', length: 20, default: 'hourly' })
  salaryType: 'hourly' | 'fixed_monthly';

  @Column({ name: 'hourly_wage', type: 'int', default: 0 })
  hourlyWage: number;

  @Column({ name: 'fixed_monthly_salary', type: 'int', default: 0 })
  fixedMonthlySalary: number;

  @Column({ name: 'daily_hours', type: 'decimal', precision: 4, scale: 1, default: 8 })
  dailyHours: number;

  @Column({ name: 'settlement_cycle_type', type: 'varchar', length: 20, default: 'calendar_month' })
  settlementCycleType: 'calendar_month' | 'anniversary';

  @Column({ name: 'note', type: 'varchar', length: 120, nullable: true })
  note: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
