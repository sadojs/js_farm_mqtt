import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 우선순위 약품 — 프로그램(해충) 내에서 순번대로 사용하는 약품 */
@Entity('spray_products')
export class SprayProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'program_id', type: 'uuid' })
  programId: string;

  /** 우선순위 (1, 2, 3 …) */
  @Column({ name: 'rank', type: 'int', default: 1 })
  rank: number;

  /** 약품명 (예: 스피노사드, 아바멕틴) */
  @Column({ name: 'name', type: 'varchar', length: 60 })
  name: string;

  /** 방재 시작일 — 기본값 = 구역 정식일 또는 앞 약품 자동 이어붙임. 수정 가능. */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** 방재 간격(일) */
  @Column({ name: 'interval_days', type: 'int', default: 3 })
  intervalDays: number;

  /** 방재 횟수(회) */
  @Column({ name: 'count', type: 'int', default: 1 })
  count: number;

  /** 벌(호박벌 등) 사용 여부 — true 면 방재일 오전 벌문 닫기 + 2일 후 벌문 개방 일정 생성 */
  @Column({ name: 'has_bees', default: false })
  hasBees: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
