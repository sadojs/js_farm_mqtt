import { ref } from 'vue'
import { useDeviceStore } from '../stores/device.store'
import { useNotificationStore } from '../stores/notification.store'
import { deviceApi } from '../api/device.api'

/**
 * 구역관리 카드 길게 눌러 드래그 정렬.
 *
 * 동작:
 *  - grip 핸들 pointerdown → 500ms 유지 시 드래그 시작(그 전에 떼거나 8px 이상 움직이면 취소 = 탭/스크롤 통과)
 *  - 드래그 중 카드는 커서를 따라 이동(transform)만 하고, 다른 카드는 그대로 둔다(라이브 재정렬 X).
 *  - pointerup(놓기) 시 **최종 커서 위치**로 삽입 위치를 결정(결정론적) → displayOrder 0..N-1 재부여 →
 *    PATCH /devices/reorder 저장. 실패 시 원래 순서로 롤백 + 토스트.
 *
 * ※ 라이브 스왑(커서가 카드 위에 올 때마다 교체)은 첫 카드/윗줄 경계에서 0↔1 진동이 생겨
 *    "맨 앞으로 못 옮김" 버그가 있었다. 놓는 위치 기준(reading-order 삽입 인덱스)으로 바꿔 해결.
 *
 * 개폐기: 드래그 단위는 대표(open) 장치. pairs[openId]=closeId 를 주면 close 도 같은 값으로 이동.
 */
const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 8

export function useReorder() {
  const deviceStore = useDeviceStore()
  const notify = useNotificationStore()

  const draggingId = ref<string | null>(null) // 드래그 중인 대표 device id
  const dragGroup = ref<string | null>(null)  // 섹션 키
  const dragDX = ref(0)                        // 커서추적 translate
  const dragDY = ref(0)

  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let orderIds: string[] = []                 // 현재 섹션 대표 id 순서
  let pairMap: Record<string, string | undefined> = {} // openId -> closeId
  let backup: Record<string, number> = {}     // 롤백용 원래 displayOrder

  function setDisplayOrder(id: string, value: number) {
    const d = deviceStore.devices.find(x => x.id === id)
    if (d) d.displayOrder = value
  }

  function applyOrder(ids: string[]) {
    ids.forEach((id, i) => {
      setDisplayOrder(id, i)
      const closeId = pairMap[id]
      if (closeId) setDisplayOrder(closeId, i) // 개폐기 close 동반 이동
    })
  }

  /** 드래그 중 카드에 적용할 스타일 (커서 추적). */
  function dragStyle(id: string) {
    if (draggingId.value !== id) return undefined
    return {
      transform: `translate(${Math.round(dragDX.value)}px, ${Math.round(dragDY.value)}px) scale(1.03)`,
      zIndex: 30,
      position: 'relative' as const,
    }
  }

  /**
   * 최종 포인터 위치(px, py)에서 같은 섹션 내 삽입 인덱스 계산.
   * reading-order 기준: 포인터보다 '앞'(윗줄, 또는 같은 줄 왼쪽)인 카드 수 = 삽입 위치.
   * 2열 그리드/1열 모두 결정론적으로 동작(진동 없음).
   */
  function computeInsertIndex(groupKey: string, dragId: string, px: number, py: number): number {
    const cards = Array.from(document.querySelectorAll(`[data-reorder-group="${CSS.escape(groupKey)}"]`))
      .filter(el => el.getAttribute('data-reorder-id') && el.getAttribute('data-reorder-id') !== dragId)
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
  }

  // ── 롱프레스 대기 단계 ──
  function onPreMove(e: PointerEvent) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) {
      cleanup() // 스크롤 의도 → 드래그 취소, 기존 동작 통과
    }
  }
  function onPreUp() {
    cleanup() // 롱프레스 발동 전 뗌 = 짧은 탭 → 클릭 통과
  }

  // ── 드래그 단계: 카드만 커서 따라 이동 (재정렬은 놓을 때) ──
  function onDragMove(e: PointerEvent) {
    e.preventDefault()
    lastX = e.clientX
    lastY = e.clientY
    dragDX.value = e.clientX - startX
    dragDY.value = e.clientY - startY
  }

  async function onDragUp() {
    const g = dragGroup.value
    const dragId = draggingId.value
    if (g && dragId) {
      const idx = computeInsertIndex(g, dragId, lastX, lastY)
      const others = orderIds.filter(id => id !== dragId)
      others.splice(idx, 0, dragId)
      orderIds = others
      applyOrder(orderIds) // 낙관적 반영
    }

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
      Object.entries(prev).forEach(([id, v]) => setDisplayOrder(id, v)) // 롤백
      notify.error('순서 저장 실패', '잠시 후 다시 시도해 주세요.')
    }
  }

  /**
   * grip 핸들 pointerdown 에 연결.
   * @param repId 대표 device id (개폐기는 open id)
   * @param groupKey 섹션 키 (구역+섹션)
   * @param ids 현재 섹션 대표 id 순서
   * @param pairs (선택) openId -> closeId 매핑
   */
  function press(
    e: PointerEvent,
    repId: string,
    groupKey: string,
    ids: string[],
    pairs?: Record<string, string | undefined>,
  ) {
    if (draggingId.value) return
    if (e.button !== undefined && e.button !== 0) return // 좌클릭/터치만
    startX = e.clientX
    startY = e.clientY
    lastX = e.clientX
    lastY = e.clientY
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
      dragDX.value = 0
      dragDY.value = 0
      navigator.vibrate?.(12)

      window.addEventListener('pointermove', onDragMove, { passive: false })
      window.addEventListener('pointerup', onDragUp)
      window.addEventListener('pointercancel', onDragUp)
    }, LONG_PRESS_MS)
  }

  return { draggingId, dragStyle, press }
}
