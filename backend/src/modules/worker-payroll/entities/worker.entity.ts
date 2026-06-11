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

  /** 시급(원) */
  @Column({ name: 'hourly_wage', type: 'int', default: 0 })
  hourlyWage: number;

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
