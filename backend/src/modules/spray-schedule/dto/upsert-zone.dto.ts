import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsInt,
  IsBoolean,
} from 'class-validator';

export class UpsertZoneDto {
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  cropType?: string;

  @IsDateString()
  transplantDate: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
