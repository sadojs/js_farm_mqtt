import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class UpsertWorkTaskTypeDto {
  @IsString()
  @Length(1, 40)
  label: string;

  /** 8~10색 스와치에서 탭. # 포함 hex */
  @IsHexColor()
  color: string;

  /** 이모지 1글자 (서로게이트 페어 허용 → 8자) */
  @IsString()
  @Length(1, 8)
  emoji: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  iconKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class ToggleHiddenDto {
  @IsBoolean()
  hidden: boolean;
}

export class CreateWorkLogDto {
  @IsUUID()
  zoneId: string;

  @IsUUID()
  taskTypeId: string;

  @IsOptional()
  @IsUUID()
  workerId?: string | null;

  /** ISO datetime — 미지정 시 서버가 now() 사용 */
  @IsOptional()
  @IsDateString()
  doneAt?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  qty?: number;
}

export class WorkLogListQueryDto {
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsUUID()
  taskTypeId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class MonthQueryDto {
  /** YYYY-MM */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month 형식은 YYYY-MM 이어야 합니다' })
  month?: string;
}
