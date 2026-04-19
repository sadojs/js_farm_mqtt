import { IsString, IsOptional, IsNumber, IsBoolean, IsUUID, IsDateString } from 'class-validator';

export class UpdateCropBatchDto {
  @IsOptional()
  @IsString()
  cropType?: string;

  @IsOptional()
  @IsString()
  seedlingType?: string;

  @IsOptional()
  @IsDateString()
  sowingDate?: string;

  @IsOptional()
  @IsDateString()
  transplantDate?: string;

  @IsOptional()
  @IsNumber()
  baseTemp?: number;

  @IsOptional()
  @IsNumber()
  targetGdd?: number;

  @IsOptional()
  @IsString()
  tempSource?: string;

  @IsOptional()
  @IsNumber()
  greenhouseOffset?: number;

  @IsOptional()
  @IsString()
  offsetSource?: string;

  @IsOptional()
  @IsUUID()
  borrowedGroupId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
