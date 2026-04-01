import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private gatewayService: GatewayManagerService,
  ) {}

  async findAll() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    const userIds = users.map(u => u.id);
    const allGateways = await this.gatewayService.findAllByUserIds(userIds);

    const result: any[] = [];
    for (const user of users) {
      let parentUserName: string | null = null;
      if (user.parentUserId) {
        const parent = await this.usersRepo.findOne({ where: { id: user.parentUserId } });
        parentUserName = parent?.name || null;
      }
      const gateways = allGateways
        .filter(gw => gw.userId === user.id)
        .map(gw => ({ id: gw.id, gatewayId: gw.gatewayId, name: gw.name, status: gw.status }));
      result.push({
        ...this.sanitize(user),
        parentUserName,
        gateways,
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
    const username = dto.username.toLowerCase();
    const exists = await this.usersRepo.findOne({ where: { username } });
    if (exists) throw new ConflictException('이미 등록된 사용자명입니다.');

    const user = this.usersRepo.create({
      username,
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
