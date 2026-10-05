import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * 경로의 :gatewayId(게이트웨이 문자열 ID, 예: lgw-xxxx) 소유권 검사.
 * - 플랫폼 관리자(admin): 통과
 * - 농장 관리자: 자기 농장 게이트웨이만 / 농장 사용자: 소속 농장 게이트웨이만
 * - :gatewayId 가 없는 경로는 통과 (예: heartbeat/status)
 * JwtAuthGuard·RolesGuard 뒤에 둔다.
 */
@Injectable()
export class GatewayOwnershipGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const gatewayId: string | undefined = req.params?.gatewayId;
    const user = req.user;
    if (!gatewayId || !user) return true;
    if (user.role === 'admin') return true;
    const farmId = user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
    const rows: Array<{ user_id: string }> = await this.dataSource.query(
      'SELECT user_id::text AS user_id FROM gateways WHERE gateway_id = $1 LIMIT 1',
      [gatewayId],
    );
    if (!rows.length) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (rows[0].user_id !== String(farmId)) {
      throw new ForbiddenException('이 게이트웨이에 대한 권한이 없습니다.');
    }
    return true;
  }
}
