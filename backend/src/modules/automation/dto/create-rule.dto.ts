import { IsString, IsOptional, IsObject, IsInt, Min, Max, IsArray } from 'class-validator';

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

  @IsOptional()
  @IsString()
  targetUserId?: string;

  /** 저장하면서 끌 기존 규칙(저장 전 충돌 확인에서 사용자가 동의한 것) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disableRuleIds?: string[];
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

  /** 저장하면서 끌 기존 규칙(저장 전 충돌 확인에서 사용자가 동의한 것) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disableRuleIds?: string[];
}

export class CheckConflictsDto {
  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsObject()
  conditions: any;

  @IsObject()
  actions: any;
}
