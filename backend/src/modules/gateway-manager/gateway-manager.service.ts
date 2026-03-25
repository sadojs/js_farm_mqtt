import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gateway } from './entities/gateway.entity';

@Injectable()
export class GatewayManagerService {
  constructor(
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
  ) {}

  async findAllByUser(userId: string) {
    return this.gatewayRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** admin: 전체 게이트웨이 조회 */
  async findAll() {
    return this.gatewayRepo.find({ order: { createdAt: 'DESC' } });
  }

  /** admin: 소유자 변경 포함 업데이트 */
  async updateByAdmin(id: string, data: { name?: string; location?: string; rpiIp?: string; userId?: string }) {
    const gw = await this.gatewayRepo.findOne({ where: { id } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (data.name !== undefined) gw.name = data.name;
    if (data.location !== undefined) gw.location = data.location;
    if (data.rpiIp !== undefined) gw.rpiIp = data.rpiIp;
    if (data.userId !== undefined) gw.userId = data.userId;
    return this.gatewayRepo.save(gw);
  }

  async findOne(id: string, userId: string) {
    const gw = await this.gatewayRepo.findOne({ where: { id, userId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    return gw;
  }

  async findByGatewayId(gatewayId: string) {
    return this.gatewayRepo.findOne({ where: { gatewayId } });
  }

  async create(userId: string, data: { gatewayId: string; name: string; location?: string; rpiIp?: string }) {
    const gateway = this.gatewayRepo.create({ userId, ...data });
    return this.gatewayRepo.save(gateway);
  }

  async update(id: string, userId: string, data: { name?: string; location?: string; rpiIp?: string; userId?: string }) {
    const gw = await this.findOne(id, userId);
    if (data.name !== undefined) gw.name = data.name;
    if (data.location !== undefined) gw.location = data.location;
    if (data.rpiIp !== undefined) gw.rpiIp = data.rpiIp;
    if (data.userId !== undefined) gw.userId = data.userId;
    return this.gatewayRepo.save(gw);
  }

  /** 특정 사용자의 게이트웨이 목록 */
  async findAllByUserIds(userIds: string[]) {
    if (userIds.length === 0) return [];
    return this.gatewayRepo
      .createQueryBuilder('gw')
      .where('gw.user_id IN (:...userIds)', { userIds })
      .orderBy('gw.created_at', 'DESC')
      .getMany();
  }

  async remove(id: string, userId: string) {
    const gw = await this.findOne(id, userId);
    await this.gatewayRepo.remove(gw);
    return { message: '게이트웨이가 삭제되었습니다.' };
  }

  /** admin: 소유자 무관하게 삭제 */
  async removeByAdmin(id: string) {
    const gw = await this.gatewayRepo.findOne({ where: { id } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    await this.gatewayRepo.remove(gw);
    return { message: '게이트웨이가 삭제되었습니다.' };
  }

  async updateStatus(gatewayId: string, status: string) {
    await this.gatewayRepo.update(
      { gatewayId },
      { status, lastSeen: new Date() },
    );
  }
}
