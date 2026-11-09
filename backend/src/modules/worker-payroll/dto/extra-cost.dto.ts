import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  IsUUID,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';

/** 기타 고용비용 — date 가 있으면 귀속 연도는 date 의 연도 */
export class SaveExtraCostDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsOptional()
  @IsDateString()
  date?: string | null;

  @IsOptional()
  @IsUUID()
  workerId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string | null;
}
