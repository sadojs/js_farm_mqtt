import { IsString, IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';

export class CreateTaskTemplateDto {
  @IsString()
  taskName: string;

  @IsOptional()
  @IsString()
  cropType?: string;

  @IsOptional()
  @IsIn(['seedling', 'vegetative', 'flowering_fruit', 'harvest'])
  stageName?: string;

  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMinDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMaxDays?: number;

  @IsInt()
  @Min(0)
  startOffsetDays: number;

  @IsOptional()
  @IsIn(['anchor', 'shift', 'one_time'])
  defaultRescheduleMode?: string;
}

export class UpdateTaskTemplateDto {
  @IsOptional()
  @IsString()
  taskName?: string;

  @IsOptional()
  @IsString()
  cropType?: string;

  @IsOptional()
  @IsIn(['seedling', 'vegetative', 'flowering_fruit', 'harvest'])
  stageName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMinDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMaxDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  startOffsetDays?: number;

  @IsOptional()
  @IsIn(['anchor', 'shift', 'one_time'])
  defaultRescheduleMode?: string;
}
