import { IsString, IsOptional, IsDateString, IsInt, Min } from 'class-validator';

export class UpsertAdvanceDto {
  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
