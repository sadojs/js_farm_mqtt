import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/** 구역별 환경 경보 설정 (검토 §7-9 ③). 저장한 구역만 경보를 감시한다. */
@Entity('env_alert_settings')
export class EnvAlertSetting {
  @PrimaryColumn({ name: 'group_id', type: 'uuid' })
  groupId: string;

  /** 구역 주인(농장 관리자) — 알림 수신 대상 */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** [{ key, enabled, threshold, minutes }] */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  items: EnvAlertItem[];

  /** 'push' = 앱 푸시 + 알림 센터, 'center' = 알림 센터만 */
  @Column({ type: 'varchar', length: 20, default: 'push' })
  channel: 'push' | 'center';

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

export type EnvAlertKey = 'temp_high' | 'humidity_high' | 'soil_low';

export interface EnvAlertItem {
  key: EnvAlertKey;
  enabled: boolean;
  threshold: number;
  minutes: number;
}
