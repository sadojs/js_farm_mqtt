import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { farmNameOf } from './farm-name.util';

type Role = 'admin' | 'farm_admin' | 'farm_user';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private gatewayService: GatewayManagerService,
    private dataSource: DataSource,
  ) {}

  async findAll() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    const byId = new Map(users.map(u => [u.id, u]));
    const userIds = users.map(u => u.id);
    const allGateways = await this.gatewayService.findAllByUserIds(userIds);

    return users.map(user => {
      const parent = user.parentUserId ? byId.get(user.parentUserId) : undefined;
      const gateways = allGateways
        .filter(gw => gw.userId === user.id)
        .map(gw => ({ id: gw.id, gatewayId: gw.gatewayId, name: gw.name, status: gw.status }));
      return {
        ...this.sanitize(user),
        // 소속 농장 관리자의 이름(사람)과 농장 이름을 구분해서 내려준다
        parentUserName: parent?.name || null,
        parentFarmName: farmNameOf(parent),
        gateways,
      };
    });
  }

  async findFarmAdmins() {
    const admins = await this.usersRepo.find({
      where: { role: 'farm_admin' as any, status: 'active' as any },
      order: { name: 'ASC' },
    });
    return admins
      .map(u => this.sanitize(u))
      .sort((a, b) => (a.farmName || '').localeCompare(b.farmName || '', 'ko'));
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

    const role: Role = dto.role || 'farm_admin';
    const parentUserId = await this.resolveParent(role, dto.parentUserId, null);

    const user = this.usersRepo.create({
      username,
      passwordHash: await bcrypt.hash(dto.password, 10),
      name: dto.name,
      role,
      parentUserId,
      address: dto.address,
      farmName: role === 'farm_admin' ? dto.farmName?.trim() || dto.name : null,
      mustChangePassword: dto.mustChangePassword ?? false,
    });
    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async updateSelf(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (dto.name) user.name = dto.name;
    if (dto.address !== undefined) user.address = dto.address;
    // 농장 관리자는 자기 농장 이름을 바꿀 수 있다
    if (dto.farmName !== undefined && user.role === 'farm_admin') {
      user.farmName = dto.farmName.trim() || user.name;
    }
    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
      // 본인이 비밀번호를 변경하면 변경 강제 해제
      user.mustChangePassword = false;
    }

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    const nextRole: Role = dto.role || user.role;

    // 농장 관리자 → 다른 역할: 소속 사용자·농장 데이터가 있으면 막는다 (데이터 소유자가 사라짐)
    if (user.role === 'farm_admin' && nextRole !== 'farm_admin') {
      const usage = await this.farmUsage(user.id);
      if (usage.members > 0 || usage.owned > 0) {
        throw new ConflictException(
          `이 계정은 농장(${farmNameOf(user)})의 관리자입니다. ${this.describeUsage(usage)} — 역할을 바꾸려면 먼저 소속 사용자와 농장 데이터를 정리하세요.`,
        );
      }
    }

    // 소속 농장: 역할이 농장 사용자면 유효한 농장 관리자를 지정, 아니면 비운다
    const parentInput = dto.parentUserId !== undefined ? dto.parentUserId : user.parentUserId;
    user.parentUserId = await this.resolveParent(nextRole, parentInput, user.id);

    if (dto.name) user.name = dto.name;
    user.role = nextRole;
    if (dto.address !== undefined) user.address = dto.address;
    if (nextRole === 'farm_admin') {
      if (dto.farmName !== undefined) user.farmName = dto.farmName.trim() || user.name;
      else if (!user.farmName) user.farmName = user.name; // 농장 사용자 → 농장 관리자로 바뀐 경우
    } else {
      user.farmName = null;
    }
    if (dto.status) user.status = dto.status;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, 10);

    const saved = await this.usersRepo.save(user);
    return this.sanitize(saved);
  }

  /**
   * 삭제 전 확인 — 지우면 복구할 수 없는 경우는 막고 "비활성화"를 안내한다.
   *  - 농장 관리자: 소속 사용자가 있거나, 게이트웨이·구역·장치가 있으면 차단 (삭제 시 농장 데이터 전부 연쇄 삭제됨)
   *  - 모든 계정: 동작 이력이 있으면 차단 (activity_logs 는 이력 보존용으로 사용자 FK 가 걸려 있어 삭제 불가)
   */
  async remove(id: string) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    if (user.role === 'farm_admin') {
      const usage = await this.farmUsage(user.id);
      if (usage.members > 0 || usage.owned > 0) {
        throw new ConflictException(
          `농장 "${farmNameOf(user)}"에 ${this.describeUsage(usage)}. 삭제하면 농장 데이터가 모두 지워져 복구할 수 없습니다. 사용을 멈추려면 계정을 '비활성'으로 바꾸세요.`,
        );
      }
    }

    const [{ count: logCount }] = await this.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM activity_logs WHERE user_id = $1',
      [id],
    );
    if (logCount > 0) {
      throw new ConflictException(
        `동작 이력 ${logCount}건이 남아 있어 삭제할 수 없습니다(이력 보존). 사용을 멈추려면 계정을 '비활성'으로 바꾸세요.`,
      );
    }

    await this.usersRepo.remove(user);
    return { message: '삭제되었습니다.' };
  }

  /** 농장 사용자의 소속 농장 검증. 농장 사용자가 아니면 null */
  private async resolveParent(role: Role, parentUserId: string | null | undefined, selfId: string | null): Promise<string | null> {
    if (role !== 'farm_user') return null;
    if (!parentUserId) throw new BadRequestException('농장 사용자는 소속 농장을 지정해야 합니다.');
    if (parentUserId === selfId) throw new BadRequestException('자기 자신을 소속 농장으로 지정할 수 없습니다.');
    const parent = await this.usersRepo.findOne({ where: { id: parentUserId } });
    if (!parent || parent.role !== 'farm_admin') {
      throw new BadRequestException('소속 농장은 농장 관리자 계정이어야 합니다.');
    }
    return parent.id;
  }

  /** 농장(농장 관리자 계정)에 딸린 소속 사용자 수와 주요 데이터 수 */
  private async farmUsage(userId: string) {
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users        WHERE parent_user_id = $1) AS members,
         (SELECT COUNT(*)::int FROM gateways     WHERE user_id = $1)        AS gateways,
         (SELECT COUNT(*)::int FROM house_groups WHERE user_id = $1)        AS zones,
         (SELECT COUNT(*)::int FROM devices      WHERE user_id = $1)        AS devices`,
      [userId],
    );
    return { ...row, owned: row.gateways + row.zones + row.devices } as {
      members: number; gateways: number; zones: number; devices: number; owned: number;
    };
  }

  private describeUsage(u: { members: number; gateways: number; zones: number; devices: number }) {
    const parts = [
      u.members ? `소속 사용자 ${u.members}명` : '',
      u.gateways ? `게이트웨이 ${u.gateways}대` : '',
      u.zones ? `구역 ${u.zones}개` : '',
      u.devices ? `장치 ${u.devices}개` : '',
    ].filter(Boolean);
    return `${parts.join(' · ')}이(가) 있습니다`;
  }

  private sanitize(user: User) {
    const { passwordHash, ...result } = user;
    return result;
  }
}
