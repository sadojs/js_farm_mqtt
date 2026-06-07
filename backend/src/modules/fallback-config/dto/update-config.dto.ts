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
}
