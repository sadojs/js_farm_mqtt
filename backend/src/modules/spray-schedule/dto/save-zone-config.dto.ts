import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsInt,
  IsBoolean,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsInt()
  @Min(1)
  rank: number;

  @IsString()
  name: string;

  @IsDateString()
  startDate: string;

  @IsInt()
  @Min(1)
  intervalDays: number;

  @IsInt()
  @Min(1)
  count: number;

  @IsOptional()
  @IsBoolean()
  hasBees?: boolean;

  @IsOptional()
  @IsIn(['am', 'pm'])
  timeOfDay?: 'am' | 'pm';
}

export class ProgramInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  pest: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductInputDto)
  products: ProductInputDto[];
}

/** 구역 카드 전체 저장 — 구역 정보 + 프로그램/약품 일괄 저장 후 이벤트 재생성 */
export class SaveZoneConfigDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  cropType?: string;

  @IsDateString()
  transplantDate: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramInputDto)
  programs: ProgramInputDto[];
}
