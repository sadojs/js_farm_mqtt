import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 일꾼 — 근무조건(시급/기본시간/근무시작일)을 가진 노동자 */
@Entity('payroll_workers')
export class Worker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'name', type: 'varchar', length: 60 })
  name: string;

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
