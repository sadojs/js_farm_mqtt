import { computed, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'

export interface DashboardWidget {
  id: string
  type: 'weather' | 'summary' | 'device-status'
  title: string
  visible: boolean
  order: number
  size: 'sm' | 'md' | 'lg' | 'full'
}

const defaultLayout: DashboardWidget[] = [
  { id: 'weather', type: 'weather', title: '날씨', visible: true, order: 0, size: 'full' },
  { id: 'summary', type: 'summary', title: '요약 카드', visible: true, order: 1, size: 'full' },
  { id: 'device-status', type: 'device-status', title: '장비 상태 정보', visible: true, order: 2, size: 'full' },
]

export function useDashboardLayout() {
  const layout = useLocalStorage<DashboardWidget[]>('sf-dashboard-layout', defaultLayout)
  const isEditMode = ref(false)

  // 레이아웃 정규화: 삭제된 위젯 제거, 새 위젯 추가
  const validIds = new Set(defaultLayout.map(w => w.id))
  const filtered = layout.value.filter(w => validIds.has(w.id))
  const existingIds = new Set(filtered.map(w => w.id))
  const added = defaultLayout.filter(dw => !existingIds.has(dw.id)).map(dw => ({ ...dw }))
  if (added.length > 0) {
    layout.value = [...filtered, ...added]
  } else if (filtered.length !== layout.value.length) {
    layout.value = filtered
  }

  const visibleWidgets = computed(() =>
    layout.value
      .filter(w => w.visible)
      .sort((a, b) => a.order - b.order)
  )

  function toggleWidget(id: string) {
    layout.value = layout.value.map(w =>
      w.id === id ? { ...w, visible: !w.visible } : w
    )
  }

  function moveWidget(id: string, direction: 'up' | 'down') {
    const sorted = [...layout.value].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex(w => w.id === id)
    if (idx === -1) return

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= sorted.length) return

    ;[sorted[idx], sorted[targetIdx]] = [sorted[targetIdx], sorted[idx]]
    layout.value = sorted.map((w, i) => ({ ...w, order: i }))
  }

  function resetLayout() {
    layout.value = defaultLayout.map(w => ({ ...w }))
  }

  function enterEditMode() { isEditMode.value = true }
  function exitEditMode() { isEditMode.value = false }

  return {
    layout,
    visibleWidgets,
    isEditMode,
    toggleWidget,
    moveWidget,
    resetLayout,
    enterEditMode,
    exitEditMode,
  }
}
