import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class TestGpioPinDto {
  @IsInt()
  @Min(2)
  @Max(27)
  pin: number

  @IsBoolean()
  state: boolean

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(30000)
  durationMs?: number
}

export class TestZigbeeChannelDto {
  @IsString()
  friendlyName: string

  @IsString()
  switchCode: string

  @IsBoolean()
  state: boolean

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(30000)
  durationMs?: number
}
