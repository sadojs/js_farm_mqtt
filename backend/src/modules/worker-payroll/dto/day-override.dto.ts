import { IsDateString, IsIn, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * 특정 일자 근무 설정.
 * status='off' → 휴일(무급, hours 0). status='work' → 절대 근무시간(hours).
 * status='work' 이고 hours 가 기본 근무시간과 같으면 조정행 삭제(기본값 복원).
 */
export class SetDayDto {
  @IsDateString()
  date: string;

  @IsIn(['work', 'off'])
  status: 'work' | 'off';

  @IsOptional()
  @IsNumber()
  @Min(0)
  hours?: number;
}
