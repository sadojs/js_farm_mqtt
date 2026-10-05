/**
 * 콘솔은 PC·태블릿 웹 전용이라 Capacitor(네이티브) 런타임을 포함하지 않는다.
 * 기존 코드(useWebSocket·appAuth 등)가 호출하는 API 만 "웹" 으로 응답하는 스텁.
 */
export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web' as const,
}
