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
  let startPointerId: number | null = null
  let startTarget: Element | null = null

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
    // 드래그 종료 리스너 제거 — 등록과 동일하게 capture:true 로 매칭해야 확실히 떨어짐.
    // (하나라도 남으면 passive:false pointermove 가 preventDefault 를 계속 걸어 스크롤이 죽음)
    window.removeEventListener('pointerup', onDragUp, true)
    window.removeEventListener('pointercancel', onDragUp, true)
    window.removeEventListener('touchend', onDragUp, true)
    window.removeEventListener('touchcancel', onDragUp, true)
    startPointerId = null
    startTarget = null
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
    // ── self-healing 안전장치 (실기기에서 pointerup/touchend 가 유실돼 cleanup 이 안 도는 경우 대비) ──
    // 1) 드래그 상태가 이미 해제됐는데 리스너가 남아있으면 스스로 제거 → 이후 스크롤 정상.
    if (draggingId.value == null) {
      window.removeEventListener('pointermove', onDragMove)
      return
    }
    // 2) 원래 드래그 포인터가 아닌 '다른 포인터'의 이동이면(=이전 드래그의 종료 이벤트가 유실됨),
    //    즉시 정리하고 이 이벤트는 preventDefault 하지 않고 통과 → 새 스크롤 제스처가 살아난다.
    if (startPointerId != null && e.pointerId !== startPointerId) {
      cleanup()
      return
    }
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
    // 그리드 열 수 판정: 2열 이상이면 읽기순서(좌→우)로 좌우(X) 기준, 1열이면 상하(Y) 기준.
    // getComputedStyle 은 repeat(auto-fill,…) 도 실제 px 트랙으로 펼쳐주므로 그대로 개수를 셈.
    // (자동제어룰 리스트는 flex-column → gridTemplateColumns='none' → 1열로 처리되어 기존 동작 유지)
    const parent = el.parentElement
    const cols = parent
      ? getComputedStyle(parent).gridTemplateColumns.split(' ').filter(Boolean).length
      : 1
    const after = cols > 1
      ? e.clientX > r.left + r.width / 2   // 카드 가로중앙 오른쪽이면 뒤에 삽입
      : e.clientY > r.top + r.height / 2   // 카드 세로중앙 아래면 뒤에 삽입
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
    if (draggingId.value == null) return // 재진입 가드(pointerup+touchend 동시 발생 대비)
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
    startPointerId = e.pointerId
    startTarget = t
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

      // 터치의 '암묵적 포인터 캡처'를 해제 → 이후 이벤트가 grip 노드(재정렬 시 이동/재생성됨)에
      // 묶이지 않고 마우스처럼 window 로 정상 버블. 이게 없으면 캡처 노드가 옮겨질 때 pointerup 이
      // window 에 도달 못 해 cleanup 이 안 돌고 → passive:false pointermove 가 남아 스크롤이 죽음.
      try {
        if (startPointerId != null && startTarget && (startTarget as Element).hasPointerCapture?.(startPointerId)) {
          (startTarget as Element).releasePointerCapture(startPointerId)
        }
      } catch { /* noop */ }

      window.addEventListener('pointermove', onDragMove, { passive: false })
      // 종료는 capture:true 로 등록 → 도중 stopPropagation 이나 캡처 타깃 문제와 무관하게 항상 실행.
      // 터치 환경 안전망으로 touchend/touchcancel 도 함께(포인터 이벤트가 유실돼도 손 떼면 정리됨).
      window.addEventListener('pointerup', onDragUp, true)
      window.addEventListener('pointercancel', onDragUp, true)
      window.addEventListener('touchend', onDragUp, true)
      window.addEventListener('touchcancel', onDragUp, true)
    }, LONG_PRESS_MS)
  }

  return { draggingId, dragStyle, press }
}
