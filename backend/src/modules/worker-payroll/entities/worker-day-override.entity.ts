import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 일자별 근무 기록 (worker_day).
 * 기본값(행 없음) = 근무(status 'work') + 기본 근무시간.
 * 행이 존재하면 그 날의 절대 시간/상태를 덮어씀.
 * 잔업(delta) 개념 없음 — hours 는 그 날의 총 근무시간(절대값).
 */
@Entity('payroll_day_overrides')
@Index(['workerId', 'date'], { unique: true })
export class WorkerDayOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  @Column({ name: 'date', type: 'date' })
  date: string;

  /** 근무 상태: 'work' | 'off'(휴일·무급) */
  @Column({ name: 'status', type: 'varchar', length: 10, default: 'work' })
  status: string;

  /** 그 날의 총 근무시간(절대값, 0.5 단위). status='off' 이면 0. */
  @Column({ name: 'hours', type: 'decimal', precision: 4, scale: 1, default: 0 })
  hours: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
