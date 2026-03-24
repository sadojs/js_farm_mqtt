import { IsIn, IsOptional, IsBoolean, IsString } from 'class-validator';

export class CompleteOccurrenceDto {
  @IsIn(['anchor', 'shift', 'one_time'])
  rescheduleMode: string;

  @IsOptional()
  @IsBoolean()
  rememberChoice?: boolean;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsOptional()
  @IsIn(['growth_fast', 'normal', 'growth_slow'])
  growthFeedback?: string;
}

export class ApplyTemplateDto {
  @IsString()
  templateId: string;
}
