import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  /** farm_user 는 부모(농장) 설정을 따른다 */
  private effectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId
      ? user.parentUserId
      : user.id;
  }

  /** 현재 사용자(농장) 기준 모든 기능 상태 */
  @Get()
  async getMine(@CurrentUser() user: any) {
    return this.service.getStates(this.effectiveUserId(user));
  }

  /** 본인(농장) 또는 플랫폼 범위 토글 — farm_admin: personal, admin: platform 가능 */
  @Patch(':feature')
  async setMine(
    @CurrentUser() user: any,
    @Param('feature') feature: string,
    @Body() body: { enabled: boolean; scope?: 'platform' | 'personal' },
  ) {
    const isAdmin = user.role === 'admin';
    const isFarmAdmin = user.role === 'farm_admin';
    if (!isAdmin && !isFarmAdmin) throw new ForbiddenException('권한이 없습니다.');
    const scope =
      body.scope === 'platform' && isAdmin ? 'platform' : this.effectiveUserId(user);
    return this.service.setFlag(feature, scope, body.enabled, user.id);
  }

  /** 플랫폼 관리자: 특정 사용자(농장)의 기능 상태 조회 */
  @Get('users/:targetUserId')
  async getForUser(@CurrentUser() user: any, @Param('targetUserId') targetUserId: string) {
    if (user.role !== 'admin') throw new ForbiddenException('플랫폼 관리자만 조회 가능합니다.');
    return this.service.getStates(targetUserId);
  }

  /** 플랫폼 관리자: 특정 사용자(농장)의 기능 토글 */
  @Patch(':feature/users/:targetUserId')
  async setForUser(
    @CurrentUser() user: any,
    @Param('feature') feature: string,
    @Param('targetUserId') targetUserId: string,
    @Body() body: { enabled: boolean },
  ) {
    if (user.role !== 'admin') throw new ForbiddenException('플랫폼 관리자만 변경 가능합니다.');
    return this.service.setFlag(feature, targetUserId, body.enabled, user.id);
  }
}
