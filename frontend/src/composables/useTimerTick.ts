import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 1초 주기로 갱신되는 `now`(ms) 반응형 ref + 카운트다운 포맷터.
 * 임시 타이머(override-until) 배지의 남은시간 표시에 사용.
 */
export function useTimerTick() {
  const now = ref(Date.now())
  let handle: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    handle = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  })
  onUnmounted(() => {
    if (handle) clearInterval(handle)
  })

  /** 남은 시간을 MM:SS 또는 H:MM:SS 로 포맷. 만료 시 null. */
  function formatCountdown(untilIso?: string | null): string | null {
    if (!untilIso) return null
    const remainMs = new Date(untilIso).getTime() - now.value
    if (remainMs <= 0) return null
    const totalSec = Math.ceil(remainMs / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  }

  /** 활성(미만료) 여부 */
  function isActive(untilIso?: string | null): boolean {
    if (!untilIso) return false
    return new Date(untilIso).getTime() > now.value
  }

  return { now, formatCountdown, isActive }
}
