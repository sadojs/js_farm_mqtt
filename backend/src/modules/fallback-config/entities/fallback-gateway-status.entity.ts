import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FallbackMode = 'online' | 'fallback' | 'unknown';

@Entity('fallback_gateway_status')
export class FallbackGatewayStatus {
  @PrimaryColumn({ name: 'gateway_id', type: 'varchar', length: 50 })
  gatewayId!: string;

  @Column({ type: 'varchar', length: 20, default: 'unknown' })
  mode!: FallbackMode;

  @Column({ name: 'mode_changed_at', type: 'timestamptz' })
  modeChangedAt!: Date;

  @Column({ name: 'last_heartbeat_seen_at', type: 'timestamptz', nullable: true })
  lastHeartbeatSeenAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
