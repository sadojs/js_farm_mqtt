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
  MinLength,
  Matches,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeductionInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  label: string;

  /** 'fixed' | 'variable' (기본 fixed) */
  @IsOptional()
  @IsIn(['fixed', 'variable'])
  kind?: 'fixed' | 'variable';

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/**
 * 일꾼 근무조건 + 기본 공제 항목 일괄 저장.
 * 신규 등록 시 username/password 를 함께 보내면 farm_user 로그인 계정을 발급.
 * (id 가 있는 수정 시에는 계정 필드 무시)
 */
export class SaveWorkerDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name: string;

  // ── 로그인 계정 (신규 등록 시) ──
  @IsOptional()
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z][a-z0-9_-]{2,49}$/, {
    message: '아이디는 영문 소문자로 시작하고 소문자·숫자·_·- 만 사용할 수 있습니다.',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // ── 근무 조건 ──
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
