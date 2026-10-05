/**
 * 비상 정지 래치 레지스트리 (프로세스 메모리 — 단일 인스턴스 운영 전제, DB 가 원본).
 * EmergencyStopService 가 부팅 시 DB 에서 채우고 정지/해제 때 갱신한다.
 * 키는 게이트웨이 문자열 ID(lgw-…)와 PK(uuid) 둘 다 등록 — MQTT 발행부는 문자열 ID, 장치는 PK 를 들고 있다.
 */
const latched = new Set<string>();

export function setGatewayLatched(refs: Array<string | null | undefined>, active: boolean) {
  for (const r of refs) {
    if (!r) continue;
    if (active) latched.add(r);
    else latched.delete(r);
  }
}

export function isGatewayLatched(ref: string | null | undefined): boolean {
  return !!ref && latched.has(ref);
}

/** ON 계열 값 판정 (z2m 'ON', boolean true, 1) */
export function isOnValue(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === 'string' && v.toUpperCase() === 'ON');
}

export class EmergencyLatchedError extends Error {
  constructor(gatewayId: string) {
    super(`비상 정지 중인 게이트웨이(${gatewayId})입니다. 비상 정지를 해제한 뒤 다시 시도하세요.`);
    this.name = 'EmergencyLatchedError';
  }
}
