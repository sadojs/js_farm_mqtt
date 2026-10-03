import { SetMetadata } from '@nestjs/common';

export const PLATFORM_SCOPE_KEY = 'farmContext:platformScope';

/**
 * 플랫폼 전용·본인 정보 라우트 표시.
 * 관리자가 X-Farm-Context 헤더를 보내도 사용자를 교체하지 않고 원래 관리자로 실행한다.
 * (@Roles 에 farm_admin 이 없는 admin 전용 라우트는 이 데코레이터 없이도 자동으로 플랫폼 취급)
 */
export const PlatformScope = () => SetMetadata(PLATFORM_SCOPE_KEY, true);
