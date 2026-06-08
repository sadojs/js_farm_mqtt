import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsIn,
} from 'class-validator';

/** 드래그 이동 */
export class MoveEventDto {
  @IsDateString()
  date: string;

  /** single = 이 일정만, following = 이 일정 + 이후 전체(같은 약품) */
  @IsIn(['single', 'following'])
  mode: 'single' | 'following';
}

/** 단건 일정 추가 (프로그램 무관, isManual=true) */
export class CreateManualEventDto {
  @IsUUID()
  zoneId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  pest?: string;

  @IsOptional()
  @IsString()
  product?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
