import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './entities/activity-log.entity';

export interface LogParams {
  userId: string;
  userName: string;
  groupId?: string;
  groupName?: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetName?: string;
  details?: any;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectRepository(ActivityLog) private repo: Repository<ActivityLog>,
  ) {}

  /** 로그 기록 (async, non-blocking — 실패해도 본 기능에 영향 없음) */
  async log(params: LogParams) {
    try {
      await this.repo.save(this.repo.create(params));
    } catch (err: any) {
      this.logger.warn(`활동 로그 기록 실패: ${err.message}`);
    }
  }

  /** 로그 목록 조회 */
  async findAll(params: {
    userId: string;
    isAdmin: boolean;
    groupId?: string;
    action?: string;
    targetType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));

    const qb = this.repo.createQueryBuilder('a')
      .orderBy('a.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // RBAC: admin은 전체, 일반은 자기 userId만
    if (!params.isAdmin) {
      qb.andWhere('a.user_id = :userId', { userId: params.userId });
    }
    if (params.groupId) {
      qb.andWhere('a.group_id = :groupId', { groupId: params.groupId });
    }
    if (params.action) {
      qb.andWhere('a.action = :action', { action: params.action });
    }
    if (params.targetType) {
      qb.andWhere('a.target_type = :targetType', { targetType: params.targetType });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }
}
