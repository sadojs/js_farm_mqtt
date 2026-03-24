import { IsString, IsOptional, IsInt, Min, Max, IsDateString, IsUUID, IsIn } from 'class-validator';

export class CreateBatchDto {
  @IsString()
  cropName: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsOptional()
  @IsString()
  houseName?: string;

  @IsOptional()
  @IsUUID()
  houseId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsDateString()
  sowDate: string;

  @IsOptional()
  @IsDateString()
  transplantDate?: string;

  @IsInt()
  @Min(1)
  @Max(365)
  growDays: number;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  cropName?: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsOptional()
  @IsString()
  houseName?: string;

  @IsOptional()
  @IsUUID()
  houseId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsDateString()
  sowDate?: string;

  @IsOptional()
  @IsDateString()
  transplantDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  growDays?: number;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class ChangeStageDto {
  @IsIn(['seedling', 'vegetative', 'flowering_fruit', 'harvest'])
  stage: string;
}
