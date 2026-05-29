import { IsBoolean, IsIn, IsOptional, Matches } from 'class-validator';

export class UpsertOpenerScheduleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(['time', 'always-open'])
  mode!: 'time' | 'always-open';

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'open_time은 HH:mm 형식이어야 합니다',
  })
  openTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'close_time은 HH:mm 형식이어야 합니다',
  })
  closeTime?: string;
}
