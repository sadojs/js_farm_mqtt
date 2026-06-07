import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('fallback_configs')
export class FallbackConfig {
  @PrimaryColumn({ name: 'gateway_id', type: 'varchar', length: 50 })
  gatewayId!: string;

  @Column({ name: 'heartbeat_timeout_seconds', type: 'int', default: 300 })
  heartbeatTimeoutSeconds!: number;

  @Column({ name: 'recovery_grace_seconds', type: 'int', default: 30 })
  recoveryGraceSeconds!: number;

  @Column({ name: 'opener_enabled', type: 'boolean', default: true })
  openerEnabled!: boolean;

  @Column({ name: 'opener_rain_override', type: 'boolean', default: true })
  openerRainOverride!: boolean;

  @Column({ name: 'irrigation_enabled', type: 'boolean', default: true })
  irrigationEnabled!: boolean;

  @Column({ name: 'irrigation_max_runtime_minutes', type: 'int', default: 30 })
  irrigationMaxRuntimeMinutes!: number;

  @Column({ name: 'fertilizer_enabled', type: 'boolean', default: true })
  fertilizerEnabled!: boolean;

  @Column({ name: 'fan_enabled', type: 'boolean', default: false })
  fanEnabled!: boolean;

  /** 트리거 측정값 종류 — 'temperature'(°C) | 'humidity'(%) */
  @Column({ name: 'fan_trigger_type', type: 'varchar', length: 20, default: 'temperature' })
  fanTriggerType!: 'temperature' | 'humidity';

  /** ON 임계값 — fanTriggerType 이 temperature 면 °C, humidity 면 % */
  @Column({ name: 'fan_on_temp', type: 'numeric', precision: 5, scale: 2, default: 35.0, transformer: { to: (v) => v, from: (v) => parseFloat(v) } })
  fanOnTemp!: number;

  /** OFF 임계값 — fanTriggerType 이 temperature 면 °C, humidity 면 % */
  @Column({ name: 'fan_off_temp', type: 'numeric', precision: 5, scale: 2, default: 28.0, transformer: { to: (v) => v, from: (v) => parseFloat(v) } })
  fanOffTemp!: number;

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'last_applied_at', type: 'timestamptz', nullable: true })
  lastAppliedAt!: Date | null;

  @Column({ name: 'last_applied_version', type: 'int', nullable: true })
  lastAppliedVersion!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
