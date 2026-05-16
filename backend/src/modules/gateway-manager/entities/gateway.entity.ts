import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('gateways')
export class Gateway {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id'  })
  userId: string;

  @Column({ name: 'gateway_id', unique: true   })
  gatewayId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  location: string;

  @Column({ name: 'rpi_ip', nullable: true })
  rpiIp: string;

  @Column({ default: 'offline' })
  status: string;

  @Column({ name: 'agent_status', default: 'offline' })
  agentStatus: string;

  @Column({ name: 'zigbee_status', default: 'offline' })
  zigbeeStatus: string;

  @Column({ name: 'last_seen', nullable: true })
  lastSeen: Date;

  @Column({ name: 'tunnel_port', nullable: true, type: 'int' })
  tunnelPort: number | null;

  @Column({ name: 'tunnel_status', default: 'disconnected' })
  tunnelStatus: string;

  @Column({ name: 'tunnel_public_key', nullable: true, type: 'text' })
  tunnelPublicKey: string | null;

  @Column({ name: 'tunnel_last_seen', nullable: true, type: 'timestamptz' })
  tunnelLastSeen: Date | null;

  @Column({ name: 'house_id', nullable: true, type: 'uuid' })
  houseId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
