import {
  IsBoolean,
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

  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(60)
  fanOnTemp?: number;

  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(60)
  fanOffTemp?: number;
}
