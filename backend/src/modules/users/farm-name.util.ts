import type { User } from './entities/user.entity';

/** 농장 표시 이름 — farm_name 이 비어 있으면(마이그레이션 051 이전 데이터 등) 계정 이름으로 대체 */
export function farmNameOf(user: Pick<User, 'farmName' | 'name'> | null | undefined): string | null {
  if (!user) return null;
  return user.farmName || user.name || null;
}
