import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeductionInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  label: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** 일꾼 근무조건 + 기본 공제 항목 일괄 저장 */
export class SaveWorkerDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name: string;

  @IsDateString()
  startDate: string;

  @IsInt()
  @Min(0)
  hourlyWage: number;

  @IsNumber()
  @Min(0)
  dailyHours: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeductionInputDto)
  deductions?: DeductionInputDto[];
}
