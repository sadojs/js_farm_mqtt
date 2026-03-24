const TUYA_ERROR_MAP: Record<string, string> = {
  'device is offline': '장비가 오프라인입니다',
  'permission deny': '권한이 없습니다',
  'token invalid': '인증이 만료되었습니다. 새로고침해 주세요',
  'param is wrong': '잘못된 명령입니다',
  'timeout': '응답 시간 초과',
}

export function translateTuyaError(msg?: string): string {
  if (!msg) return '알 수 없는 오류'
  return TUYA_ERROR_MAP[msg] || msg
}
