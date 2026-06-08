import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 방재 구역 — 하나의 정식일/작물을 가진 재배 구역 (소프트 참조: house_groups) */
@Entity('spray_zones')
export class SprayZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 구역 관리(house_groups) 연결 — 선택 (소프트 FK, 없어도 됨) */
  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ name: 'name', type: 'varchar', length: 60 })
  name: string;

  @Column({ name: 'crop_type', type: 'varchar', length: 40, nullable: true })
  cropType: string | null;

  /** 정식일 — 약품 시작일 기본값의 기준 */
  @Column({ name: 'transplant_date', type: 'date' })
  transplantDate: string;

  /** 달력에서 구역 구분용 색 (구역색) */
  @Column({ name: 'color', type: 'varchar', length: 16, default: '#43a047' })
  color: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
