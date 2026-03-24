import { IsString, IsOptional, IsObject, IsInt, Min, Max } from 'class-validator';

export class CreateRuleDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  houseId?: string;

  @IsObject()
  conditions: any;

  @IsObject()
  actions: any;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  priority?: number;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsObject()
  conditions?: any;

  @IsOptional()
  @IsString()
  houseId?: string;

  @IsOptional()
  @IsObject()
  actions?: any;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  priority?: number;
}
