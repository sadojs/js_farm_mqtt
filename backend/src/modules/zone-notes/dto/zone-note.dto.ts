import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const TAGS = ['water', 'nutrient', 'pest', 'env', 'etc'] as const;

export class CreateZoneNoteDto {
  @IsUUID()
  zoneId: string;

  @IsIn(TAGS)
  tag: 'water' | 'nutrient' | 'pest' | 'env' | 'etc';

  @IsString()
  @Length(1, 1000)
  text: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateZoneNoteDto {
  @IsOptional()
  @IsIn(TAGS)
  tag?: 'water' | 'nutrient' | 'pest' | 'env' | 'etc';

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  text?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
