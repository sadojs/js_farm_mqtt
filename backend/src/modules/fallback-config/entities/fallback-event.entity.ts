import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type FallbackEventType =
  | 'mode_change'
  | 'rule_fired'
  | 'safety_off'
  | 'sync_ack';

@Entity('fallback_events')
@Index(['gatewayId', 'occurredAt'])
export class FallbackEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'gateway_id', type: 'varchar', length: 50 })
  gatewayId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: FallbackEventType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'reported_at', type: 'timestamptz' })
  reportedAt!: Date;
}
