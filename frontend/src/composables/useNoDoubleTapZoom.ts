import { onMounted, onBeforeUnmount } from 'vue'

/**
 * 모바일 더블탭 확대 차단 보강.
 *
 * CSS `touch-action: manipulation` 으로 대부분의 브라우저는 막히지만
 * iOS 일부 버전 / 구형 안드로이드는 그래도 더블탭 확대가 동작한다.
 * → touchend 두 번이 `threshold`(ms) 이내 + 같은 좌표 `radius`(px) 이내면
 *   두 번째를 preventDefault 해서 확대 트리거 자체를 차단한다.
 *
 * 정상적인 빠른 단일 탭 / 멀리 떨어진 두 번째 탭 / 스크롤은 통과.
 * `.allow-zoom` 자손은 예외 (차트/이미지 핀치줌 보존).
 */
export function useNoDoubleTapZoom(threshold = 350, radius = 30) {
  let lastTap = 0
  let lastX = 0
  let lastY = 0

  function handler(e: TouchEvent) {
    const target = e.target as HTMLElement | null
    if (target?.closest('.allow-zoom')) return

    const now = performance.now()
    const t = e.changedTouches[0]
    if (!t) return

    const dt = now - lastTap
    const dx = Math.abs(t.clientX - lastX)
    const dy = Math.abs(t.clientY - lastY)

    if (dt > 0 && dt <= threshold && dx <= radius && dy <= radius) {
      e.preventDefault()
      lastTap = 0
      return
    }
    lastTap = now
    lastX = t.clientX
    lastY = t.clientY
  }

  onMounted(() => {
    document.addEventListener('touchend', handler, { passive: false })
  })
  onBeforeUnmount(() => {
    document.removeEventListener('touchend', handler)
  })
}
