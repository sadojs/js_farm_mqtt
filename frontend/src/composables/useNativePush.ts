/**
 * 네이티브 푸시(OS 알림) 등록 — iOS(APNs) / Android(FCM)
 *
 * 웹(데스크톱·모바일 브라우저)에서는 `isNativePlatform()` 이 false 라 **아무 동작도 하지 않는다**.
 * 즉 기존 웹 서비스 동작에 영향 0. 앱(Capacitor)에서만 실행된다.
 *
 * 흐름:
 *   1) 알림 권한 요청 → 2) FCM/APNs 토큰 발급 → 3) 백엔드에 토큰 등록
 *   4) 포그라운드 수신은 기존 인앱 알림(Socket.io)이 담당하므로 중복 표시하지 않는다.
 */
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import apiClient from '../api/client'

export const isNativeApp = () => Capacitor.isNativePlatform()

/** 발급받은 토큰 (디버깅/표시용) */
let currentToken: string | null = null
export const getPushToken = () => currentToken

/** 백엔드에 디바이스 토큰 등록 (실패해도 앱 동작에 지장 없도록 흡수) */
async function registerTokenToServer(token: string) {
  try {
    await apiClient.post('/notifications/device-token', {
      token,
      platform: Capacitor.getPlatform(), // 'ios' | 'android'
    })
    console.log('[push] 토큰 서버 등록 완료')
  } catch (e) {
    console.warn('[push] 토큰 서버 등록 실패(무시):', e)
  }
}

/**
 * 앱에서 1회 호출. 웹에서는 즉시 반환(no-op).
 * 로그인 이후에 호출해야 토큰이 사용자와 매핑된다.
 */
export async function initNativePush(): Promise<void> {
  if (!isNativeApp()) return // ← 웹은 여기서 종료 (no-op)

  try {
    // 1) 권한 확인/요청
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') {
      console.warn('[push] 알림 권한 거부됨')
      return
    }

    // 2) 토큰 발급 리스너 (register() 전에 등록해야 놓치지 않음)
    await PushNotifications.addListener('registration', (t) => {
      currentToken = t.value
      console.log('[push] 토큰 발급:', t.value)
      void registerTokenToServer(t.value)
    })

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] 토큰 발급 실패:', JSON.stringify(err))
    })

    // 3) 백그라운드에서 도착한 알림을 탭했을 때
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[push] 알림 탭:', JSON.stringify(action.notification?.data ?? {}))
    })

    // 4) 앱이 포그라운드인 동안 수신 — 인앱 알림(Socket.io)과 중복되므로 로그만 남긴다.
    await PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.log('[push] 포그라운드 수신(표시 생략):', n.title)
    })

    // 5) APNs/FCM 등록 실행
    await PushNotifications.register()
    console.log('[push] register() 호출 완료')
  } catch (e) {
    console.error('[push] 초기화 실패:', e)
  }
}
