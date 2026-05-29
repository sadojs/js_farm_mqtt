import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  ValidateNested,
} from 'class-validator';

class FallbackEventDto {
  @IsIn(['mode_change', 'rule_fired', 'safety_off', 'sync_ack'])
  eventType!: 'mode_change' | 'rule_fired' | 'safety_off' | 'sync_ack';

  @IsObject()
  payload!: Record<string, unknown>;

  @IsDateString()
  occurredAt!: string;
}

export class BatchFallbackEventsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FallbackEventDto)
  events!: FallbackEventDto[];
}
