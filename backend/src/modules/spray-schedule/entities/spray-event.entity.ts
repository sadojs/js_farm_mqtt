import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 방재 이벤트 — 달력에 표시되는 1건의 방재.
 * 자동 생성 이벤트(isManual=false) + 단건 추가(isManual=true).
 * pinned=true 이면 재생성 시에도 보존(드래그 이동된 이벤트).
 */
@Entity('spray_events')
@Index(['userId', 'date'])
export class SprayEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @Column({ name: 'program_id', type: 'uuid', nullable: true })
  programId: string | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'date', type: 'date' })
  date: string;

  /** 해충/약종명 (스냅샷) */
  @Column({ name: 'pest', type: 'varchar', length: 40, nullable: true })
  pest: string | null;

  /** 약품명 (스냅샷) */
  @Column({ name: 'product', type: 'varchar', length: 60, nullable: true })
  product: string | null;

  /** 약종색 (스냅샷) */
  @Column({ name: 'color', type: 'varchar', length: 16, nullable: true })
  color: string | null;

  /** 차수 — 약품별 1차부터 */
  @Column({ name: 'round', type: 'int', default: 1 })
  round: number;

  /** 이벤트 종류: 'spray'(방재) | 'bee_open'(벌문 개방) */
  @Column({ name: 'kind', type: 'varchar', length: 12, default: 'spray' })
  kind: string;

  /** 벌 사용 방재 여부 — 방재일 벌문 닫기 필요 표시 */
  @Column({ name: 'bee', default: false })
  bee: boolean;

  /** 방재 시간대 스냅샷: 'am' | 'pm' (방재 이벤트). 벌문 개방은 항상 오전. */
  @Column({ name: 'time_of_day', type: 'varchar', length: 2, nullable: true })
  timeOfDay: string | null;

  @Column({ name: 'is_manual', default: false })
  isManual: boolean;

  /** 드래그로 이동되어 재생성에서 보존되어야 하는 이벤트 */
  @Column({ name: 'pinned', default: false })
  pinned: boolean;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
