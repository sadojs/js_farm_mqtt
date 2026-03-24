import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, ManyToMany, JoinTable,
} from 'typeorm';
import { House } from './house.entity';
import { Device } from '../../devices/entities/device.entity';

@Entity('house_groups')
export class HouseGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  manager: string;

  @Column({ name: 'enable_group_control', default: true })
  enableGroupControl: boolean;

  @Column({ name: 'enable_automation', default: false })
  enableAutomation: boolean;

  @OneToMany(() => House, house => house.group)
  houses: House[];

  @ManyToMany(() => Device)
  @JoinTable({
    name: 'group_devices',
    joinColumn: { name: 'group_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'device_id', referencedColumnName: 'id' },
  })
  devices: Device[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
