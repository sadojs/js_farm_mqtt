<script setup lang="ts">
/**
 * EquipmentIcon — 장치 타입 아이콘 시스템 공통 컴포넌트
 *
 * 원칙: "타입=색/모양 + 켜짐 여부=채도" 를 아이콘 하나로 동시에 전달.
 * - 자동 제어 설정, 대시보드, 구역 관리 등 모든 화면에서 동일 사용
 * - active=true: 칩 배경 = 타입색 12% 투명, 아이콘 = 타입색
 * - active=false: 칩 배경 = bg-hover, 아이콘 = text-muted
 * - 색은 style.css의 --device-* CSS 변수만 사용 (다크모드 자동 대응)
 *
 * 타입 매핑:
 *   fan          환풍기  --device-fan        #2196f3
 *   irrigation   관수    --device-irrigation #00bcd4
 *   opener_open  개폐기  --device-opener     #ff9800
 *   opener_close 개폐기  --device-opener     #ff9800
 *   opener       개폐기  --device-opener     #ff9800 (자동제어 규칙 detectRuleKind 결과)
 *   other        기타    --device-other      #607d8b
 */
import { computed } from 'vue'

export type EquipmentKind =
  | 'fan'
  | 'irrigation'
  | 'opener'
  | 'opener_open'
  | 'opener_close'
  | 'other'
  | 'sensor'
  | string  // graceful fallback

interface Props {
  type: EquipmentKind | undefined | null
  active?: boolean
  size?: number  // SVG 내부 크기(px). 칩은 size+12
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  size: 20,
})

// 타입 정규화 — opener_open/opener_close → opener로 합침
const normalizedType = computed<'fan' | 'irrigation' | 'opener' | 'sensor' | 'other'>(() => {
  const t = props.type ?? 'other'
  if (t === 'opener_open' || t === 'opener_close' || t === 'opener') return 'opener'
  if (t === 'fan') return 'fan'
  if (t === 'irrigation') return 'irrigation'
  if (t === 'sensor') return 'sensor'
  return 'other'
})

// 타입별 색 CSS 변수
const typeColorVar = computed(() => {
  switch (normalizedType.value) {
    case 'fan': return 'var(--device-fan, #2196f3)'
    case 'irrigation': return 'var(--device-irrigation, #00bcd4)'
    case 'opener': return 'var(--device-opener, #ff9800)'
    case 'sensor': return 'var(--device-sensor, #9c27b0)'
    default: return 'var(--device-other, #607d8b)'
  }
})

const chipSize = computed(() => `${props.size + 12}px`)
const svgSize = computed(() => `${props.size}px`)

const chipStyle = computed(() => {
  if (props.active) {
    // 활성: 타입색 채도 (배경은 타입색의 옅은 톤)
    return {
      width: chipSize.value,
      height: chipSize.value,
      // color-mix가 폭넓게 지원되지만 fallback으로 rgba 사용
      background: `color-mix(in srgb, ${typeColorVar.value} 12%, transparent)`,
      color: typeColorVar.value,
    }
  }
  // 비활성: 회색
  return {
    width: chipSize.value,
    height: chipSize.value,
    background: 'var(--bg-hover, #eef2f6)',
    color: 'var(--text-muted, #9ca3af)',
  }
})
</script>

<template>
  <span class="equipment-icon-chip" :style="chipStyle" :title="title">
    <!-- 환풍기 (fan): 팬 블레이드 + 중앙 원 -->
    <svg v-if="normalizedType === 'fan'" :width="svgSize" :height="svgSize" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8c0-2.8.6-4.6 1.8-5.6 1-.8 2.3-.5 2.8.8.5 1.2-.2 2.6-1.5 3.1l-3.1 1.7Z" />
      <path d="M14.2 12c2.8 0 4.6.6 5.6 1.8.8 1 .5 2.3-.8 2.8-1.2.5-2.6-.2-3.1-1.5L14.2 12Z" />
      <path d="M12 14.2c0 2.8-.6 4.6-1.8 5.6-1 .8-2.3.5-2.8-.8-.5-1.2.2-2.6 1.5-3.1L12 14.2Z" />
      <path d="M9.8 12c-2.8 0-4.6-.6-5.6-1.8-.8-1-.5-2.3.8-2.8 1.2-.5 2.6.2 3.1 1.5L9.8 12Z" />
    </svg>

    <!-- 관수 (irrigation): 물방울 -->
    <svg v-else-if="normalizedType === 'irrigation'" :width="svgSize" :height="svgSize" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>

    <!-- 개폐기 (opener): 창문/셔터 -->
    <svg v-else-if="normalizedType === 'opener'" :width="svgSize" :height="svgSize" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12h16" />
      <path d="M12 4v16" />
    </svg>

    <!-- 측정기 (sensor): 그래프 라인 -->
    <svg v-else-if="normalizedType === 'sensor'" :width="svgSize" :height="svgSize" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>

    <!-- 기타 (other): 톱니 (설정) -->
    <svg v-else :width="svgSize" :height="svgSize" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  </span>
</template>

<style scoped>
.equipment-icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.equipment-icon-chip svg {
  display: block;
}
</style>
