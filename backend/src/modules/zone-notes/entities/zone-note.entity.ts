import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 구역 메모 — 구역별 특징/노하우(다음 작기 참고용). 패널에서만 표시. */
@Entity('zone_notes')
@Index(['zoneId'])
export class ZoneNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 농장 소유자(farm_admin) id — 데이터 스코프 */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  /** 'water' | 'nutrient' | 'pest' | 'env' | 'etc' */
  @Column({ name: 'tag', type: 'varchar', length: 12, default: 'etc' })
  tag: string;

  @Column({ name: 'text', type: 'text' })
  text: string;

  /** 패널 내 상단 정렬용 (화면 띠 노출 아님) */
  @Column({ name: 'pinned', default: false })
  pinned: boolean;

  @Column({ name: 'created_by_user', type: 'uuid', nullable: true })
  createdByUser: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 60, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
