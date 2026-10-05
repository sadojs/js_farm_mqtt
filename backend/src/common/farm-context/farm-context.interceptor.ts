import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PLATFORM_SCOPE_KEY } from './platform-scope.decorator';
import {
  FARM_CONTEXT_APPLIED_HEADER,
  FARM_CONTEXT_HEADER,
  FarmContextCode,
  FarmContextException,
} from './farm-context.constants';
import { FarmContextService } from './farm-context.service';
import { farmContextStorage } from './farm-context.storage';

/**
 * 관리자 농장 컨텍스트 (옵트인).
 *
 * - 헤더(X-Farm-Context)가 없으면 아무것도 하지 않는다 → 기존 동작 100% 동일.
 * - 실행 순서: guard(JwtAuthGuard·RolesGuard) → **이 인터셉터** → pipe·파라미터 해석 → 핸들러.
 *   따라서 RolesGuard 는 원래 관리자 권한으로 통과하고, @CurrentUser()/@Req() 는 교체된 사용자를 본다.
 * - 관리자 + 농장 라우트: 대상 검증 후 req.user 를 그 농장 관리자로 교체.
 * - 관리자 + 플랫폼 라우트(@PlatformScope 또는 admin 전용 @Roles): 헤더 무시.
 * - 비관리자 + 헤더: 403 (무시하고 통과시키지 않음 — 권한 상승 방지).
 * - 공개 라우트(req.user 없음): 헤더 무시.
 */
@Injectable()
export class FarmContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly farmContext: FarmContextService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const raw = req.headers?.[FARM_CONTEXT_HEADER];
    const farmId = (Array.isArray(raw) ? raw[0] : raw ?? '').toString().trim();
    if (!farmId) return next.handle(); // 헤더 없음 → 변경 전과 동일

    const user = req.user;
    if (!user) return next.handle(); // 공개 라우트 — 인증 주체가 없어 권한 상승 불가
    if (user.role !== 'admin') throw new FarmContextException(FarmContextCode.FORBIDDEN);

    const res = context.switchToHttp().getResponse();
    if (this.isPlatformRoute(context)) {
      res.setHeader(FARM_CONTEXT_APPLIED_HEADER, 'none');
      return next.handle();
    }

    const farm = await this.farmContext.resolveFarm(farmId);
    req.realUser = user;
    req.user = {
      id: farm.id,
      username: farm.username,
      name: farm.name,
      role: 'farm_admin',
      parentUserId: null,
      farmContext: true,
      actingAdminId: user.id,
      actingAdminUsername: user.username,
    };
    res.setHeader(FARM_CONTEXT_APPLIED_HEADER, farm.id);

    const store = { farmId: farm.id, actingAdminId: user.id, actingAdminUsername: user.username };
    // handle() 호출과 구독을 모두 ALS 컨텍스트 안에서 수행 → 핸들러의 비동기 흐름 전체가 store 를 본다
    return new Observable((subscriber) =>
      farmContextStorage.run(store, () => next.handle().subscribe(subscriber)),
    );
  }

  private isPlatformRoute(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_SCOPE_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
    return !!roles && !roles.includes('farm_admin'); // admin 전용 라우트는 자동 플랫폼
  }
}
