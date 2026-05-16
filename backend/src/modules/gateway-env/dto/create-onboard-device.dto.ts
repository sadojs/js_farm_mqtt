import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateOnboardDeviceDto {
  @IsIn(['fan', 'irrigation', 'vent'])
  type: 'fan' | 'irrigation' | 'vent'

  @IsString()
  @MinLength(1)
  name: string

  @IsOptional()
  @IsIn([8, 12])
  channels?: 8 | 12
}
