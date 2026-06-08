import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 방재 프로그램 — 해충(약종) 단위. 우선순위 약품들을 묶는다. */
@Entity('spray_programs')
export class SprayProgram {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  /** 해충 종류 / 약종명 (예: 총채약, 진딧물약, 응애약, 역병약) */
  @Column({ name: 'pest', type: 'varchar', length: 40 })
  pest: string;

  /** 약종색 (이벤트 칩 배경색) */
  @Column({ name: 'color', type: 'varchar', length: 16, default: '#e53935' })
  color: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
