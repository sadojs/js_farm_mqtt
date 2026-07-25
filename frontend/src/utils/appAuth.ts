/**
 * 앱(Capacitor) 전용 인증 보조 유틸 — 웹에서는 전부 no-op.
 *
 * 배경: 앱은 출처가 capacitor://localhost · http://localhost 라 백엔드로의 httpOnly
 * refresh 쿠키가 교차출처로 취급돼 전송되지 않는다. → 앱은 X-Client 헤더를 보내고,
 * 서버가 body 로 내려준 refresh token 을 네이티브 저장소(Preferences)에 보관해
 * 다음 refresh 요청 body 로 직접 전달한다. (Plan v2 §5.2)
 *
 * Preferences 는 iOS UserDefaults / Android SharedPreferences 를 쓰므로 WebView 의
 * JS(localStorage)에서 접근 불가 → localStorage 보다 안전. (완전한 보안저장은 Keychain/
 * EncryptedSharedPreferences 플러그인으로 추후 강화 가능)
 */
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const RT_KEY = 'sf_app_refresh_token'

export const isNativeApp = (): boolean => Capacitor.isNativePlatform()

/** 백엔드가 '-app' 접미사로 앱을 판별 → 'ios-app' | 'android-app' | undefined(웹) */
export const appClientHeader = (): string | undefined =>
  isNativeApp() ? `${Capacitor.getPlatform()}-app` : undefined

export async function saveAppRefreshToken(token: string | undefined | null): Promise<void> {
  if (!isNativeApp() || !token) return
  await Preferences.set({ key: RT_KEY, value: token })
}

export async function loadAppRefreshToken(): Promise<string | undefined> {
  if (!isNativeApp()) return undefined
  const { value } = await Preferences.get({ key: RT_KEY })
  return value ?? undefined
}

export async function clearAppRefreshToken(): Promise<void> {
  if (!isNativeApp()) return
  await Preferences.remove({ key: RT_KEY })
}
