import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 일꾼 근무 프로필 (worker_profile). 로그인 계정(account_user_id)과 연결. */
@Entity('payroll_workers')
export class Worker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 농장 소유자(farm_admin) user id — 데이터 스코프 기준 */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 일꾼 로그인 계정(farm_user) user id — 본인 조회용 (선택) */
  @Column({ name: 'account_user_id', type: 'uuid', nullable: true })
  accountUserId: string | null;

  @Column({ name: 'name', type: 'varchar', length: 60 })
  name: string;

  @Column({ name: 'phone', type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  /** 근무시작일 — 매월 정산 기준일(같은 날) */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** 퇴사일. NULL=재직중. 그 일자까지 근무, 다음날부터 정산/달력 제외. */
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  /** 급여 방식: 'hourly'(시급×시간) | 'fixed_monthly'(고정 월급) */
  @Column({ name: 'salary_type', type: 'varchar', length: 20, default: 'hourly' })
  salaryType: 'hourly' | 'fixed_monthly';

  /** 시급(원) — salary_type='hourly' 일 때 사용 */
  @Column({ name: 'hourly_wage', type: 'int', default: 0 })
  hourlyWage: number;

  /** 고정 월급(원) — salary_type='fixed_monthly' 일 때 사용. 부분 기간(입·퇴사)은 일할 계산. */
  @Column({ name: 'fixed_monthly_salary', type: 'int', default: 0 })
  fixedMonthlySalary: number;

  /**
   * 정산 주기:
   * - 'calendar_month'(기본): 매월 1일~말일 (첫 정산만 입사일~말일)
   * - 'anniversary': 입사일의 '일(day)'을 앵커로 매월 (예: 5/6 입사 → 5/6~6/5, 6/6 정산)
   */
  @Column({ name: 'settlement_cycle_type', type: 'varchar', length: 20, default: 'calendar_month' })
  settlementCycleType: 'calendar_month' | 'anniversary';

  /** 기본 근무시간(시간/일) — 0.5 단위 허용 */
  @Column({ name: 'daily_hours', type: 'decimal', precision: 4, scale: 1, default: 8 })
  dailyHours: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
