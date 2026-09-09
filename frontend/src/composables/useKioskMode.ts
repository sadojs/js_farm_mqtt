/**
 * useKioskMode — 하우스 고정 설치용 옵션 3종
 *
 * 저장: localStorage['sf-kiosk-nozoom' | 'sf-kiosk-fullscreen' | 'sf-kiosk-dimming']
 * 태블릿 모드에서만 UI 노출 (판정은 useLayoutMode 참고)
 *
 * ⚠️ 제약
 *  - requestFullscreen() 은 사용자 제스처 안에서만 호출 가능. 새로고침 후 자동 진입 불가.
 *    실제 운영은 크롬 "홈 화면에 추가"(PWA) 나 키오스크 런처 앱을 권장.
 *  - 화면 백라이트는 웹에서 제어 불가. CSS filter 로 어둡게 보이게만 한다.
 *  - 확대 잠금에서 touchmove 를 막을 때 반드시 touches.length > 1 조건을 걸 것.
 *    무조건 막으면 Groups.vue 의 롱프레스 타이머와 드래그 정렬이 죽는다.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'

const KEY_ZOOM = 'sf-kiosk-nozoom'
const KEY_FULL = 'sf-kiosk-fullscreen'
const KEY_DIM  = 'sf-kiosk-dimming'

const DIM_START_HOUR = 19  // 19시부터
const DIM_END_HOUR   = 6   // 06시까지
const DIM_BRIGHTNESS = 0.75

function readBool(key: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(key) === '1'
}

const noZoom = ref(readBool(KEY_ZOOM))
const fullscreen = ref(readBool(KEY_FULL))
const dimming = ref(readBool(KEY_DIM))
const isFullscreenActive = ref(false)
const isDimmed = ref(false)

export function useKioskMode() {
  // ── 확대/축소 잠금 ──
  let originalViewport = ''

  function applyNoZoom(on: boolean) {
    const meta = document.querySelector('meta[name="viewport"]')
    if (!meta) return
    if (on) {
      if (!originalViewport) originalViewport = meta.getAttribute('content') ?? ''
      meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    } else if (originalViewport) {
      meta.setAttribute('content', originalViewport)
    }
  }

  function onTouchMove(e: TouchEvent) {
    // 멀티터치(핀치)만 차단 — 싱글터치는 롱프레스 타이머/드래그에 필요
    if (e.touches.length > 1) e.preventDefault()
  }

  // ── 전체화면 ──
  // 반드시 사용자 클릭 핸들러 안에서 호출할 것
  async function enterFullscreen(): Promise<boolean> {
    try {
      if (document.fullscreenElement) return true
      await document.documentElement.requestFullscreen()
      return true
    } catch {
      return false
    }
  }

  async function exitFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch { /* noop */ }
  }

  function onFullscreenChange() {
    isFullscreenActive.value = !!document.fullscreenElement
  }

  // ── 야간 감광 ──
  let dimTimer: ReturnType<typeof setInterval> | null = null

  function isNightNow(): boolean {
    const h = new Date().getHours()
    return h >= DIM_START_HOUR || h < DIM_END_HOUR
  }

  function applyDimming() {
    const app = document.getElementById('app')
    if (!app) return
    const on = dimming.value && isNightNow()
    isDimmed.value = on
    app.style.transition = 'filter .6s'
    app.style.filter = on ? `brightness(${DIM_BRIGHTNESS})` : ''
  }

  // ── setters (사용자 제스처 안에서 호출) ──
  function setNoZoom(on: boolean) {
    noZoom.value = on
    localStorage.setItem(KEY_ZOOM, on ? '1' : '0')
    applyNoZoom(on)
    if (on) document.addEventListener('touchmove', onTouchMove, { passive: false })
    else document.removeEventListener('touchmove', onTouchMove)
  }

  async function setFullscreen(on: boolean) {
    fullscreen.value = on
    localStorage.setItem(KEY_FULL, on ? '1' : '0')
    if (on) await enterFullscreen()
    else await exitFullscreen()
  }

  function setDimming(on: boolean) {
    dimming.value = on
    localStorage.setItem(KEY_DIM, on ? '1' : '0')
    applyDimming()
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    if (noZoom.value) {
      applyNoZoom(true)
      document.addEventListener('touchmove', onTouchMove, { passive: false })
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    onFullscreenChange()
    applyDimming()
    dimTimer = setInterval(applyDimming, 60_000)
  })

  onUnmounted(() => {
    if (typeof window === 'undefined') return
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    if (dimTimer) clearInterval(dimTimer)
  })

  watch(dimming, applyDimming)

  return {
    noZoom, fullscreen, dimming,
    isFullscreenActive, isDimmed,
    setNoZoom, setFullscreen, setDimming,
    enterFullscreen,
  }
}
