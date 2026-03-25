/**
 * 보호 필드 목록 (dot notation)
 * Config Agent와 동일한 목록 유지
 */
export const PROTECTED_FIELDS = [
  'mqtt.base_topic',
  'mqtt.server',
  'mqtt.user',
  'mqtt.password',
  'advanced.network_key',
  'advanced.pan_id',
  'serial',
  'devices',
  'groups',
] as const;

/** 요청 config에서 보호 필드 제거 (2차 검증) */
export function removeProtectedFields(config: Record<string, any>): Record<string, any> {
  const safe = JSON.parse(JSON.stringify(config));

  for (const field of PROTECTED_FIELDS) {
    const keys = field.split('.');
    let current: any = safe;
    for (let i = 0; i < keys.length - 1; i++) {
      if (current == null || typeof current !== 'object') break;
      current = current[keys[i]];
    }
    if (current != null && typeof current === 'object') {
      delete current[keys[keys.length - 1]];
    }
  }

  return safe;
}
