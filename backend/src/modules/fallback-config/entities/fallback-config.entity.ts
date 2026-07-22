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

  /** 개폐기 온습도 트리거 종류 — 'temperature'(°C) | 'humidity'(%) (유동팬과 동일 방식) */
  @Column({ name: 'opener_trigger_type', type: 'varchar', length: 20, default: 'temperature' })
  openerTriggerType!: 'temperature' | 'humidity';

  /** 개방 임계값 — 측정값이 이 값을 넘으면 개방 (°C 또는 %) */
  @Column({ name: 'opener_on_value', type: 'numeric', precision: 5, scale: 2, default: 30.0, transformer: { to: (v) => v, from: (v) => parseFloat(v) } })
  openerOnValue!: number;

  /** 닫힘 임계값 — 측정값이 이 값 아래면 닫힘 (°C 또는 %) */
  @Column({ name: 'opener_off_value', type: 'numeric', precision: 5, scale: 2, default: 25.0, transformer: { to: (v) => v, from: (v) => parseFloat(v) } })
  openerOffValue!: number;

  /** 온습도계 최근값 유효시간(초). 초과 시 온습도계 이상으로 보고 월별 시간 스케줄(백업)로 동작 */
  @Column({ name: 'sensor_timeout_seconds', type: 'int', default: 1200 })
  sensorTimeoutSeconds!: number;

  /** 게이트웨이(Pi) 공통 개폐기 동작 시간(초) — 닫힘/열림 펄스 지속 시간 */
  @Column({ name: 'opener_operation_seconds', type: 'int', default: 30 })
  openerOperationSeconds!: number;

  /** 게이트웨이 공통 개폐기 대기 시간(초) — 동작 사이 휴지 */
  @Column({ name: 'opener_standby_seconds', type: 'int', default: 60 })
  openerStandbySeconds!: number;

  /** [고온 무대기 강제열림] 활성 토글(구역 환경설정). 기본 OFF — 미설정 시 기존 동작 그대로. */
  @Column({ name: 'high_temp_override_enabled', type: 'boolean', default: false })
  highTempOverrideEnabled!: boolean;

  /** [고온 무대기 강제열림] 임계 온도(°C). 비 그친 뒤 내부온도 ≥ 이 값이면 대기 없이 연속 개방. */
  @Column({
    name: 'high_temp_open_threshold', type: 'numeric', precision: 5, scale: 2, nullable: true,
    transformer: { to: (v) => v, from: (v) => (v == null ? null : parseFloat(v)) },
  })
  highTempOpenThreshold!: number | null;

  /** 게이트웨이 공통 유동팬 동작 시간(분) */
  @Column({ name: 'fan_operation_minutes', type: 'int', default: 50 })
  fanOperationMinutes!: number;

  /** 게이트웨이 공통 유동팬 대기 시간(분) */
  @Column({ name: 'fan_standby_minutes', type: 'int', default: 10 })
  fanStandbyMinutes!: number;

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'last_applied_at', type: 'timestamptz', nullable: true })
  lastAppliedAt!: Date | null;

  @Column({ name: 'last_applied_version', type: 'int', nullable: true })
  lastAppliedVersion!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
