import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { FarmContextCode, FarmContextException } from './farm-context.constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FarmTarget {
  id: string;
  username: string;
  name: string;
}

/** 농장 컨텍스트 대상 검증 — HTTP 인터셉터와 소켓 게이트웨이가 함께 사용 */
@Injectable()
export class FarmContextService {
  constructor(@InjectRepository(User) private users: Repository<User>) {}

  /** 대상이 존재·farm_admin·active 인지 검증. 실패 시 FarmContextException */
  async resolveFarm(farmId: string): Promise<FarmTarget> {
    if (!UUID_RE.test(farmId)) throw new FarmContextException(FarmContextCode.INVALID);
    const u = await this.users.findOne({
      where: { id: farmId },
      select: ['id', 'username', 'name', 'role', 'status'],
    });
    if (!u) throw new FarmContextException(FarmContextCode.NOT_FOUND);
    if (u.role !== 'farm_admin') throw new FarmContextException(FarmContextCode.NOT_FARM_ADMIN);
    if (u.status !== 'active') throw new FarmContextException(FarmContextCode.INACTIVE);
    return { id: u.id, username: u.username, name: u.name };
  }
}
