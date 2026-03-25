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

  async update(id: string, userId: string, data: { name?: string; location?: string; rpiIp?: string }) {
    const gw = await this.findOne(id, userId);
    if (data.name !== undefined) gw.name = data.name;
    if (data.location !== undefined) gw.location = data.location;
    if (data.rpiIp !== undefined) gw.rpiIp = data.rpiIp;
    return this.gatewayRepo.save(gw);
  }

  async remove(id: string, userId: string) {
    const gw = await this.findOne(id, userId);
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
