import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class LoginDto {
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
