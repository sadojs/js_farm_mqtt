/**
 * 장비 타입(equipmentType) 한국어 라벨 매핑 및 헬퍼.
 * 백엔드 enum은 영문 유지(`fan` | `irrigation` | `opener_open` | `opener_close` | `other`),
 * 프론트 표시 계층에서만 한국어로 변환한다.
 */

export const EQUIPMENT_TYPE_LABEL_KR: Record<string, string> = {
  fan: '환풍기',
  irrigation: '관수',
  opener_open: '개폐기 (열기)',
  opener_close: '개폐기 (닫기)',
  other: '기타',
}

interface DeviceLike {
  equipmentType?: string | null
  deviceType?: string | null
}

/**
 * 장치의 표시용 한국어 장비 라벨 반환.
 * - 개폐기 페어 대표(opener_open) 단독 노출 시: "개폐기"
 *   (옵션 `openerPaired: false` — 모달에서 페어 카드를 한 개의 단위로 표시할 때 사용)
 * - 그 외: 매핑 라벨 반환. 매핑 없으면 영문 원본 fallback (또는 deviceType 기반 기본값)
 */
export function getEquipmentLabel(
  device: DeviceLike,
  opts?: { openerPaired?: boolean },
): string {
  const t = device.equipmentType
  if (!t) {
    return device.deviceType === 'sensor' ? '측정기' : '장치'
  }
  if (t === 'opener_open' && opts?.openerPaired === false) {
    return '개폐기'
  }
  return EQUIPMENT_TYPE_LABEL_KR[t] ?? t
}
