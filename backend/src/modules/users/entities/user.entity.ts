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

  /** 농장 이름 — 농장 관리자(farm_admin)만 사용. 그 외 역할은 NULL (소속 농장 이름은 부모의 farm_name) */
  @Column({ name: 'farm_name', type: 'varchar', length: 100, nullable: true })
  farmName: string | null;

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
