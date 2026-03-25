import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  async findAll() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    const result: any[] = [];
    for (const user of users) {
      let parentUserName: string | null = null;
      if (user.parentUserId) {
        const parent = await this.usersRepo.findOne({ where: { id: user.parentUserId } });
        parentUserName = parent?.name || null;
      }
      result.push({
        ...this.sanitize(user),
        parentUserName,
      });
    }
    return result;
  }

  async findFarmAdmins() {
    const admins = await this.usersRepo.find({
      where: { role: 'farm_admin' as any, status: 'active' as any },
      order: { name: 'ASC' },
    });
    return admins.map(u => this.sanitize(u));
  }

  getEffectiveUserId(user: { id: string; role: string; parentUserId?: string | null }): string {
    if (user.role === 'farm_user' && user.parentUserId) {
      return user.parentUserId;
    }
    return user.id;
  }

  async findOne(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return this.sanitize(user);
  }

  async create(dto: CreateUserDto) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('이미 등록된 이메일입니다.');

    const user = this.usersRepo.create({
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, 10),
      name: dto.name,
      role: dto.role || 'farm_admin',
      parentUserId: dto.parentUserId || null,
      address: dto.address,
    });
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async updateSelf(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.name) user.name = dto.name;
    if (dto.address !== undefined) user.address = dto.address;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, 10);

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.name) user.name = dto.name;
    if (dto.role) user.role = dto.role;
    if (dto.parentUserId !== undefined) user.parentUserId = dto.parentUserId || null;
    if (dto.address !== undefined) user.address = dto.address;
    if (dto.status) user.status = dto.status;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, 10);

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async remove(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    await this.usersRepo.remove(user);
    return { message: '삭제되었습니다.' };
  }

  private sanitize(user: User) {
    const { passwordHash, ...result } = user;
    return result;
  }
}
