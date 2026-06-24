import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 기능 토글 설정.
 * - scope = 'platform' : 플랫폼 전체 기본값(관리자만 변경)
 * - scope = '<userId>' : 해당 농장(소유자) 개인 설정
 * 행이 없으면 enabled=true 로 간주(=기본 노출).
 */
@Entity('feature_settings')
export class FeatureSetting {
  @PrimaryColumn({ name: 'feature', type: 'varchar', length: 40 })
  feature: string;

  @PrimaryColumn({ name: 'scope', type: 'varchar', length: 64 })
  scope: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'updated_by', type: 'varchar', length: 64, nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
