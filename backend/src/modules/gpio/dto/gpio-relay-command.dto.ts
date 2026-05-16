import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GpioRelayCommandDto {
  @IsString()
  slot: string;

  @IsInt()
  @Min(2)
  @Max(27)
  pin: number;

  @IsBoolean()
  state: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;
}
