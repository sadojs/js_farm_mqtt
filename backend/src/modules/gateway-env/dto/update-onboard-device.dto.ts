import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

export class UpdateOnboardDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  operationTime?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  standbyTime?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(27)
  gpioPin?: number | null;
}
