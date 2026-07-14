import { ref } from 'vue'
import { useDeviceStore } from '../stores/device.store'
import { useNotificationStore } from '../stores/notification.store'
import { deviceApi } from '../api/device.api'

/**
 * 구역관리 카드 길게 눌러 드래그 정렬.
 *
 * 동작:
 *  - grip 핸들에서 pointerdown → 500ms 유지 시 드래그 시작(그 전에 떼거나 8px 이상 움직이면 취소 = 탭/스크롤 통과)
 *  - 드래그 중 pointer 아래 같은 섹션(data-reorder-group) 카드 위로 오면 순서 교체 →
 *    store 의 displayOrder 를 0..N-1 로 재부여(낙관적) → 기존 정렬 accessor 가 즉시 재렌더
 *  - pointerup 확정 → PATCH /devices/reorder 로 저장. 실패 시 원래 순서로 롤백 + 토스트.
 *
 * 개폐기: 드래그 단위는 대표(open) 장치. pairs[openId]=closeId 를 주면 close 도 같은 값으로 이동.
 */
const LONG_PRESS_MS = 500
const MOVE_CANCEL_PX = 8

export function useReorder() {
  const deviceStore = useDeviceStore()
  const notify = useNotificationStore()

  const draggingId = ref<string | null>(null) // 드래그 중인 대표 device id
  const dragGroup = ref<string | null>(null)  // 섹션 키(힛테스트 제한)

  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
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

  // ── 롱프레스 대기 단계 ──
  function onPreMove(e: PointerEvent) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) {
      // 스크롤 의도 → 드래그 취소, 기존 동작 통과
      cleanup()
    }
  }
  function onPreUp() {
    // 롱프레스 발동 전에 뗌 = 짧은 탭 → 아무것도 안 함(클릭 통과)
    cleanup()
  }

  // ── 드래그 단계 ──
  function onDragMove(e: PointerEvent) {
    e.preventDefault()
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
      ?.closest('[data-reorder-id]') as HTMLElement | null
    if (!el) return
    if (el.getAttribute('data-reorder-group') !== dragGroup.value) return
    const overId = el.getAttribute('data-reorder-id')
    if (!overId || overId === draggingId.value) return
    const from = orderIds.indexOf(draggingId.value as string)
    const to = orderIds.indexOf(overId)
    if (from === -1 || to === -1) return
    orderIds.splice(to, 0, orderIds.splice(from, 1)[0])
    applyOrder(orderIds)
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
      // 롤백
      Object.entries(prev).forEach(([id, v]) => setDisplayOrder(id, v))
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
    orderIds = [...ids]
    pairMap = pairs || {}

    window.addEventListener('pointermove', onPreMove)
    window.addEventListener('pointerup', onPreUp)
    window.addEventListener('pointercancel', onPreUp)

    pressTimer = setTimeout(() => {
      // 드래그 발동
      window.removeEventListener('pointermove', onPreMove)
      window.removeEventListener('pointerup', onPreUp)
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

  return { draggingId, press }
}
