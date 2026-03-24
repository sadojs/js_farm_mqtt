import { IsString, IsIn, IsUUID } from 'class-validator';

export class CreateTaskLogDto {
  @IsUUID()
  batchId: string;

  @IsString()
  @IsIn(['leaf_removal', 'training', 'pesticide'])
  taskType: string;
}
