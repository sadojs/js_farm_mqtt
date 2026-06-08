import { IsDateString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

/** 특정 일자 조정 — 휴일 토글 또는 잔업/조퇴(deltaHours). 둘 다 기본값이면 조정 삭제. */
export class SetDayOverrideDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsBoolean()
  holiday?: boolean;

  @IsOptional()
  @IsNumber()
  deltaHours?: number;
}
