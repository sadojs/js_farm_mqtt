import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('env_roles')
export class EnvRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_key', unique: true })
  roleKey: string;

  @Column()
  label: string;

  @Column({ default: 'internal' })
  category: string;

  @Column({ default: '' })
  unit: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_default', default: true })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
