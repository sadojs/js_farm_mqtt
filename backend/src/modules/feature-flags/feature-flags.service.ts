import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeatureSetting } from './entities/feature-setting.entity';

/** 토글 가능한 부가기능 키 (생육관리는 별도 crop_feature_settings 사용) */
export const TOGGLEABLE_FEATURES = [
  'work_log',
  'spray_schedule',
  'worker_payroll',
] as const;
export type FeatureKey = (typeof TOGGLEABLE_FEATURES)[number];

export interface FeatureState {
  enabled: boolean;
  platformEnabled: boolean;
  userEnabled: boolean;
  lockedByAdmin: boolean;
}

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureSetting)
    private readonly repo: Repository<FeatureSetting>,
  ) {}

  private assertFeature(feature: string): asserts feature is FeatureKey {
    if (!(TOGGLEABLE_FEATURES as readonly string[]).includes(feature)) {
      throw new BadRequestException(`알 수 없는 기능: ${feature}`);
    }
  }

  /** userId(소유자) 기준 모든 기능 상태 — 행이 없으면 기본 enabled=true */
  async getStates(userId: string): Promise<Record<FeatureKey, FeatureState>> {
    const rows = await this.repo.find({
      where: { scope: In(['platform', userId]) },
    });
    const out = {} as Record<FeatureKey, FeatureState>;
    for (const feature of TOGGLEABLE_FEATURES) {
      const platform = rows.find((r) => r.feature === feature && r.scope === 'platform');
      const personal = rows.find((r) => r.feature === feature && r.scope === userId);
      const platformEnabled = platform?.enabled ?? true;
      const userEnabled = personal?.enabled ?? true;
      const lockedByAdmin =
        personal !== undefined &&
        !personal.enabled &&
        personal.updatedBy !== null &&
        personal.updatedBy !== userId;
      out[feature] = {
        enabled: platformEnabled && userEnabled,
        platformEnabled,
        userEnabled,
        lockedByAdmin,
      };
    }
    return out;
  }

  async setFlag(feature: string, scope: string, enabled: boolean, updatedBy: string) {
    this.assertFeature(feature);
    const existing = await this.repo.findOne({ where: { feature, scope } });
    if (existing) {
      existing.enabled = enabled;
      existing.updatedBy = updatedBy;
      await this.repo.save(existing);
    } else {
      await this.repo.save(
        this.repo.create({ feature, scope, enabled, updatedBy }),
      );
    }
    return { ok: true, feature, scope, enabled };
  }
}
