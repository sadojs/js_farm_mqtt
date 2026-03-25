import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('gateways')
export class Gateway {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'gateway_id', unique: true })
  gatewayId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  location: string;

  @Column({ name: 'rpi_ip', nullable: true })
  rpiIp: string;

  @Column({ default: 'offline' })
  status: string;

  @Column({ name: 'last_seen', nullable: true })
  lastSeen: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
