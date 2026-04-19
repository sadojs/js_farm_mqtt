import { IsString, IsOptional, IsNumber, IsUUID, IsDateString } from 'class-validator';

export class CreateCropBatchDto {
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsString()
  cropType: string;

  @IsString()
  seedlingType: string;

  @IsDateString()
  sowingDate: string;

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
}
