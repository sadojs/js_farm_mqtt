/**
 * 계정 상태(active/inactive) 짧은 캐시 — 요청마다 DB 를 치지 않으면서 비활성화가 최대 30초 안에 반영되게 한다.
 * 사용자 상태를 바꾸는 곳(UsersService.update/remove)은 invalidateUserStatus 로 즉시 무효화한다.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { active: boolean; at: number }>();

export function getCachedUserActive(userId: string): boolean | undefined {
  const hit = cache.get(userId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(userId); return undefined; }
  return hit.active;
}

export function setCachedUserActive(userId: string, active: boolean) {
  cache.set(userId, { active, at: Date.now() });
}

export function invalidateUserStatus(userId: string) {
  cache.delete(userId);
}
