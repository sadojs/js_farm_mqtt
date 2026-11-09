import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeductionInputDto } from './worker.dto';

/**
 * 시즌 생성 = 재고용. 지난 시즌 기록은 그대로 두고 새 기간·조건으로 시작한다.
 * 공제: deductions 가 오면 그대로, 없으면 copyDeductionsFromSeasonId 의 공제를 복사(새 id).
 */
export class CreateSeasonDto {
  @IsDateString()
  startDate: string;

  /** 예정 귀국일 (선택) */
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsIn(['hourly', 'fixed_monthly'])
  salaryType?: 'hourly' | 'fixed_monthly';

  @IsInt()
  @Min(0)
  hourlyWage: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fixedMonthlySalary?: number;

  /** 하루 기본 근무시간 — 0.5 단위 */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  dailyHours: number;

  @IsOptional()
  @IsIn(['calendar_month', 'anniversary'])
  settlementCycleType?: 'calendar_month' | 'anniversary';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;

  @IsOptional()
  @IsUUID()
  copyDeductionsFromSeasonId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeductionInputDto)
  deductions?: DeductionInputDto[];
}

/** 시즌 조건 수정 (부분). 마감된 시즌은 409. */
export class UpdateSeasonDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** null·'' 이면 근무 중으로 되돌림 */
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsIn(['hourly', 'fixed_monthly'])
  salaryType?: 'hourly' | 'fixed_monthly';

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyWage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fixedMonthlySalary?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  dailyHours?: number;

  @IsOptional()
  @IsIn(['calendar_month', 'anniversary'])
  settlementCycleType?: 'calendar_month' | 'anniversary';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeductionInputDto)
  deductions?: DeductionInputDto[];
}
