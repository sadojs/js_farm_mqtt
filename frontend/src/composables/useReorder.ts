import { ref } from 'vue'
import { useDeviceStore } from '../stores/device.store'
import { useNotificationStore } from '../stores/notification.store'
import { deviceApi } from '../api/device.api'

/**
 * 구역관리 카드 길게 눌러 드래그 정렬 (실시간 재정렬).
 *
 * 동작:
 *  - grip pointerdown → 500ms 유지 시 드래그 시작(그 전 떼거나 8px↑ 이동 = 탭/스크롤 통과)
 *  - 드래그 중 **커서 위치를 기준으로 다른 카드들이 실시간으로 밀려나며** 들어갈 자리를 보여줌.
 *    삽입 인덱스는 포인터 절대좌표(reading-order)로 계산 → 진동 없음, 맨앞/윗줄도 정확히 이동.
 *  - pointerup 시 확정 → PATCH /devices/reorder 저장. 실패 시 롤백 + 토스트.
 *
 * 개폐기: 드래그 단위는 대표(open). pairs[openId]=closeId 를 주면 close 도 같은 값으로 이동.
 */
const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 8

export function useReorder() {
  const deviceStore = useDeviceStore()
  const notify = useNotificationStore()

  const draggingId = ref<string | null>(null)
  const dragGroup = ref<string | null>(null)

  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let orderIds: string[] = []
  let pairMap: Record<string, string | undefined> = {}
  let backup: Record<string, number> = {}

  function setDisplayOrder(id: string, value: number) {
    const d = deviceStore.devices.find(x => x.id === id)
    if (d) d.displayOrder = value
  }

  function applyOrder(ids: string[]) {
    ids.forEach((id, i) => {
      setDisplayOrder(id, i)
      const closeId = pairMap[id]
      if (closeId) setDisplayOrder(closeId, i)
    })
  }

  /** 드래그 중인 카드: 살짝 확대 + 위로(그림자는 .dragging CSS). */
  function dragStyle(id: string) {
    if (draggingId.value !== id) return undefined
    return { transform: 'scale(1.03)', zIndex: 30, position: 'relative' as const }
  }

  /**
   * 포인터(px,py)에서 같은 섹션 내 삽입 인덱스 계산.
   * reading-order: 포인터보다 '앞'(윗줄 / 같은 줄 왼쪽 절반)인 카드 수.
   * 드래그 카드 제외한 형제들의 현재 렌더 위치 기준 → 결정론적(진동 없음).
   */
  function computeInsertIndex(groupKey: string, dragId: string, px: number, py: number): number {
    const cards = Array.from(document.querySelectorAll(`[data-reorder-group="${CSS.escape(groupKey)}"]`))
      .filter(el => {
        const id = el.getAttribute('data-reorder-id')
        return id && id !== dragId
      })
    let idx = 0
    for (const el of cards) {
      const r = el.getBoundingClientRect()
      const cy = r.top + r.height / 2
      const cx = r.left + r.width / 2
      const sameRow = Math.abs(cy - py) <= r.height / 2
      const before = cy < py - r.height / 2 || (sameRow && cx < px)
      if (before) idx++
    }
    return idx
  }

  function reorderTo(px: number, py: number) {
    const g = dragGroup.value
    const dragId = draggingId.value
    if (!g || !dragId) return
    const idx = computeInsertIndex(g, dragId, px, py)
    const others = orderIds.filter(id => id !== dragId)
    others.splice(idx, 0, dragId)
    const changed = others.length !== orderIds.length || others.some((id, i) => id !== orderIds[i])
    if (changed) {
      orderIds = others
      applyOrder(orderIds)
    }
  }

  function cleanup() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
    window.removeEventListener('pointermove', onPreMove)
    window.removeEventListener('pointerup', onPreUp)
    window.removeEventListener('pointercancel', onPreUp)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    window.removeEventListener('pointercancel', onDragUp)
    draggingId.value = null
    dragGroup.value = null
  }

  // ── 롱프레스 대기 ──
  function onPreMove(e: PointerEvent) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) cleanup()
  }
  function onPreUp() { cleanup() }

  // ── 드래그 중: 실시간 재정렬 ──
  function onDragMove(e: PointerEvent) {
    e.preventDefault()
    reorderTo(e.clientX, e.clientY)
  }

  async function onDragUp() {
    const finalIds = [...orderIds]
    const prev = { ...backup }
    cleanup()

    const orders: { id: string; displayOrder: number }[] = []
    finalIds.forEach((id, i) => {
      orders.push({ id, displayOrder: i })
      const closeId = pairMap[id]
      if (closeId) orders.push({ id: closeId, displayOrder: i })
    })
    try {
      await deviceApi.reorder(orders)
    } catch {
      Object.entries(prev).forEach(([id, v]) => setDisplayOrder(id, v))
      notify.error('순서 저장 실패', '잠시 후 다시 시도해 주세요.')
    }
  }

  /**
   * grip pointerdown 에 연결.
   * @param repId 대표 device id (개폐기는 open id)
   * @param groupKey 섹션 키
   * @param ids 현재 섹션 대표 id 순서
   * @param pairs (선택) openId -> closeId
   */
  function press(
    e: PointerEvent,
    repId: string,
    groupKey: string,
    ids: string[],
    pairs?: Record<string, string | undefined>,
  ) {
    if (draggingId.value) return
    if (e.button !== undefined && e.button !== 0) return
    // 컨트롤(토글/버튼/입력) 위에서 시작하면 무시 → 기존 조작 유지
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, input, select, textarea, a, label')) return
    // 터치는 grip 에서만 시작 (카드 본문 터치는 스크롤 보존). 마우스는 카드 어디서나 가능.
    if (e.pointerType === 'touch' && !t?.closest?.('.drag-grip')) return
    startX = e.clientX
    startY = e.clientY
    orderIds = [...ids]
    pairMap = pairs || {}

    window.addEventListener('pointermove', onPreMove)
    window.addEventListener('pointerup', onPreUp)
    window.addEventListener('pointercancel', onPreUp)

    pressTimer = setTimeout(() => {
      window.removeEventListener('pointermove', onPreMove)
      window.removeEventListener('pointerup', onPreUp)
      window.removeEventListener('pointercancel', onPreUp)
      pressTimer = null

      backup = {}
      for (const id of orderIds) {
        const d = deviceStore.devices.find(x => x.id === id)
        if (d) backup[id] = d.displayOrder ?? 0
        const closeId = pairMap[id]
        if (closeId) {
          const c = deviceStore.devices.find(x => x.id === closeId)
          if (c) backup[closeId] = c.displayOrder ?? 0
        }
      }
      draggingId.value = repId
      dragGroup.value = groupKey
      navigator.vibrate?.(12)

      window.addEventListener('pointermove', onDragMove, { passive: false })
      window.addEventListener('pointerup', onDragUp)
      window.addEventListener('pointercancel', onDragUp)
    }, LONG_PRESS_MS)
  }

  return { draggingId, dragStyle, press }
}
