import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  // 검증 전 소문자/trim 정규화 — iOS Safari 자동 대문자화(예: Admin)로 인한 로그인 실패(400/401) 방지
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_-]{2,49}$/, { message: '사용자명은 영문 소문자로 시작하고, 영문 소문자/숫자/_/-만 사용 가능합니다.' })
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}
