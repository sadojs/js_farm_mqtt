import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateFallbackConfigDto {
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  heartbeatTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  recoveryGraceSeconds?: number;

  @IsOptional()
  @IsBoolean()
  openerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  openerRainOverride?: boolean;

  @IsOptional()
  @IsBoolean()
  irrigationEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  irrigationMaxRuntimeMinutes?: number;

  @IsOptional()
  @IsBoolean()
  fertilizerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  fanEnabled?: boolean;

  /** 트리거 측정값 종류. temperature 면 fan_on_temp/off_temp 가 °C, humidity 면 % */
  @IsOptional()
  @IsIn(['temperature', 'humidity'])
  fanTriggerType?: 'temperature' | 'humidity';

  /** ON 임계값 — 범위는 -10~100 (°C 또는 %) */
  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(100)
  fanOnTemp?: number;

  /** OFF 임계값 — 범위는 -10~100 (°C 또는 %) */
  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(100)
  fanOffTemp?: number;

  /** 개폐기 온습도 트리거 종류. temperature 면 opener_on/off_value 가 °C, humidity 면 % */
  @IsOptional()
  @IsIn(['temperature', 'humidity'])
  openerTriggerType?: 'temperature' | 'humidity';

  /** 개방 임계값 — 범위는 -10~100 (°C 또는 %) */
  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(100)
  openerOnValue?: number;

  /** 닫힘 임계값 — 범위는 -10~100 (°C 또는 %) */
  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(100)
  openerOffValue?: number;

  /** 온습도계 최근값 유효시간(초). 초과 시 백업(월별 시간 스케줄)으로 전환 */
  @IsOptional()
  @IsInt()
  @Min(120)
  @Max(3600)
  sensorTimeoutSeconds?: number;

  /** 게이트웨이 공통 개폐기 동작 시간(초) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  openerOperationSeconds?: number;

  /** 게이트웨이 공통 개폐기 대기 시간(초) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  openerStandbySeconds?: number;

  /** 게이트웨이 공통 유동팬 동작 시간(분) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  fanOperationMinutes?: number;

  /** 게이트웨이 공통 유동팬 대기 시간(분) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  fanStandbyMinutes?: number;
}
