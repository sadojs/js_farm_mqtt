import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 100 })
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 20 })
  role: 'admin' | 'farm_admin' | 'farm_user';

  @Column({ name: 'parent_user_id', type: 'uuid', nullable: true })
  parentUserId: string | null;

  @Column({ nullable: true })
  address: string;

  @Column({ name: 'voice_aliases', type: 'jsonb', default: '{}' })
  voiceAliases: Record<string, string>;

  @Column({ default: 'active' })
  status: 'active' | 'inactive';

  /** 임시 비밀번호 발급 계정 — 첫 로그인 시 비밀번호 변경 강제 */
  @Column({ name: 'must_change_password', default: false })
  mustChangePassword: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
