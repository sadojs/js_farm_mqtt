import { IsString, MinLength, MaxLength, Matches, IsOptional, IsIn } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_-]{2,49}$/, { message: '사용자명은 영문 소문자로 시작하고, 영문 소문자/숫자/_/-만 사용 가능합니다.' })
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['admin', 'farm_admin', 'farm_user'])
  role?: 'admin' | 'farm_admin' | 'farm_user';

  @IsOptional()
  @IsString()
  parentUserId?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['admin', 'farm_admin', 'farm_user'])
  role?: 'admin' | 'farm_admin' | 'farm_user';

  @IsOptional()
  @IsString()
  parentUserId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
