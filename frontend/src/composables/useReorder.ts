import { ref, nextTick } from 'vue'
import { useNotificationStore } from '../stores/notification.store'

/**
 * 드래그 정렬 범용 컴포저블 옵션.
 * - setOrder(id, i): 낙관적으로 로컬 순서값 반영
 * - getOrder(id): 롤백용 현재 순서값
 * - persist(orders): 서버 저장 (PATCH .../reorder)
 */
export interface ReorderOptions {
  setOrder: (id: string, value: number) => void
  getOrder: (id: string) => number
  persist: (orders: { id: string; displayOrder: number }[]) => Promise<unknown>
}

/**
 * 길게 눌러 드래그 정렬 (구역관리 카드 / 자동제어룰 / 구역 목록 공용).
 *
 * - 카드 아무 곳이나 500ms 길게 누르면 드래그 시작(컨트롤 위 제외, 터치는 grip 에서만).
 * - 드래그 카드는 **커서를 따라 이동**(translate)하고 그림자로 떠오름.
 * - 재정렬은 **커서 아래 실제 카드**(elementFromPoint) 기준 — 카드 높이가 제각각이어도 정확.
 *   그 카드의 세로 중앙 위/아래로 앞/뒤 삽입(결정론적 → 진동 없음). 재정렬로 슬롯이 바뀌면
 *   anchor 를 보정해 카드가 커서에 계속 붙어있게 한다.
 * - pointerup 확정 → PATCH /devices/reorder. 실패 시 롤백 + 토스트.
 *
 * 개폐기: 드래그 단위는 대표(open). pairs[openId]=closeId 면 close 도 같은 값으로 이동.
 */
const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 8

export function useReorder(opts: ReorderOptions) {
  const notify = useNotificationStore()

  const draggingId = ref<string | null>(null)
  const dragGroup = ref<string | null>(null)
  const dragDX = ref(0)
  const dragDY = ref(0)

  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let anchorX = 0
  let anchorY = 0
  let lastX = 0
  let lastY = 0
  let dragEl: HTMLElement | null = null
  let orderIds: string[] = []
  let pairMap: Record<string, string | undefined> = {}
  let backup: Record<string, number> = {}

  function setDisplayOrder(id: string, value: number) {
    opts.setOrder(id, value)
  }

  function applyOrder(ids: string[]) {
    ids.forEach((id, i) => {
      setDisplayOrder(id, i)
      const closeId = pairMap[id]
      if (closeId) setDisplayOrder(closeId, i)
    })
  }

  /** 드래그 카드: 커서 추적 translate + 확대(그림자는 .dragging CSS). */
  function dragStyle(id: string) {
    if (draggingId.value !== id) return undefined
    return {
      transform: `translate(${Math.round(dragDX.value)}px, ${Math.round(dragDY.value)}px) scale(1.03)`,
      zIndex: 30,
      position: 'relative' as const,
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
    dragDX.value = 0
    dragDY.value = 0
    dragEl = null
  }

  // ── 롱프레스 대기 ──
  function onPreMove(e: PointerEvent) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) cleanup()
  }
  function onPreUp() { cleanup() }

  // ── 드래그: 커서 추적 + 커서 아래 카드 기준 재정렬 ──
  function onDragMove(e: PointerEvent) {
    e.preventDefault()
    lastX = e.clientX
    lastY = e.clientY
    dragDX.value = e.clientX - anchorX
    dragDY.value = e.clientY - anchorY

    // 드래그 카드는 pointer-events:none 이라 아래의 실제 카드가 잡힘 (높이 무관)
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
      ?.closest('[data-reorder-id]') as HTMLElement | null
    if (!el || el.getAttribute('data-reorder-group') !== dragGroup.value) return
    const overId = el.getAttribute('data-reorder-id')
    if (!overId || overId === draggingId.value) return

    const r = el.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2 // 그 카드 세로중앙 아래면 뒤에 삽입
    const others = orderIds.filter(id => id !== draggingId.value)
    let tIdx = others.indexOf(overId)
    if (tIdx === -1) return
    if (after) tIdx += 1
    others.splice(tIdx, 0, draggingId.value as string)

    const changed = others.length !== orderIds.length || others.some((id, i) => id !== orderIds[i])
    if (!changed) return

    const beforeTop = dragEl?.offsetTop ?? 0
    const beforeLeft = dragEl?.offsetLeft ?? 0
    orderIds = others
    applyOrder(orderIds)
    // 슬롯 이동량만큼 anchor 보정 → 카드가 커서에 계속 붙어있게
    nextTick(() => {
      if (!dragEl || draggingId.value == null) return
      anchorX += dragEl.offsetLeft - beforeLeft
      anchorY += dragEl.offsetTop - beforeTop
      dragDX.value = lastX - anchorX
      dragDY.value = lastY - anchorY
    })
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
      await opts.persist(orders)
    } catch {
      Object.entries(prev).forEach(([id, v]) => setDisplayOrder(id, v))
      notify.error('순서 저장 실패', '잠시 후 다시 시도해 주세요.')
    }
  }

  /**
   * 카드/그립 pointerdown 에 연결.
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
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, input, select, textarea, a, label')) return // 컨트롤은 기존 조작
    if (e.pointerType === 'touch' && !t?.closest?.('.drag-grip')) return // 터치는 grip 에서만(스크롤 보존)
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
        backup[id] = opts.getOrder(id)
        const closeId = pairMap[id]
        if (closeId) backup[closeId] = opts.getOrder(closeId)
      }
      // 모바일 롱프레스로 시작된 텍스트 선택이 있으면 해제 (카드 선택과 동시에 텍스트 선택되는 문제)
      try { window.getSelection?.()?.removeAllRanges?.() } catch { /* noop */ }
      draggingId.value = repId
      dragGroup.value = groupKey
      dragEl = document.querySelector(`[data-reorder-id="${CSS.escape(repId)}"]`) as HTMLElement | null
      anchorX = startX; anchorY = startY
      lastX = startX; lastY = startY
      dragDX.value = 0; dragDY.value = 0
      navigator.vibrate?.(12)

      window.addEventListener('pointermove', onDragMove, { passive: false })
      window.addEventListener('pointerup', onDragUp)
      window.addEventListener('pointercancel', onDragUp)
    }, LONG_PRESS_MS)
  }

  return { draggingId, dragStyle, press }
}
