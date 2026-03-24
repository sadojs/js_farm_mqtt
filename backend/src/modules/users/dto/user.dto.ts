import { IsEmail, IsString, MinLength, IsOptional, IsIn, IsBoolean } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

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

export class UpdateTuyaProjectDto {
  @IsString()
  name: string;

  @IsString()
  accessId: string;

  @IsOptional()
  @IsString()
  accessSecret?: string;

  @IsString()
  endpoint: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
