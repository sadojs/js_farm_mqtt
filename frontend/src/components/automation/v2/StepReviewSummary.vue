<template>
  <div class="step-review">
    <h3 class="step-title">이렇게 만들까요?</h3>

    <!-- 자연어 요약 카드 -->
    <div class="summary-card">
      <!-- 농장 -->
      <div class="summary-section clickable" role="button" tabindex="0"
        aria-label="농장 수정하기"
        @click="emit('jump-to', 'farm')"
        @keydown.enter="emit('jump-to', 'farm')">
        <span class="section-icon">📌</span>
        <span class="section-text">{{ groupName }}</span>
        <span class="edit-hint">수정</span>
      </div>

      <div class="divider" />

      <!-- 장치 -->
      <div class="summary-section clickable" role="button" tabindex="0"
        :aria-label="`${deviceSectionTitle} 수정하기`"
        @click="emit('jump-to', deviceStep)"
        @keydown.enter="emit('jump-to', deviceStep)">
        <span class="section-icon">{{ intentIcon }}</span>
        <div class="section-body">
          <span class="section-text">{{ deviceText }}</span>
        </div>
        <span class="edit-hint">수정</span>
      </div>

      <div class="divider" />

      <!-- 시점 -->
      <div class="summary-section clickable" role="button" tabindex="0"
        aria-label="시점 수정하기"
        @click="emit('jump-to', 'timing')"
        @keydown.enter="emit('jump-to', 'timing')">
        <span class="section-icon">⏰</span>
        <span class="section-text" style="white-space: pre-line;">{{ timingText }}</span>
        <span class="edit-hint">수정</span>
      </div>
    </div>

    <!-- 룰 이름 -->
    <div class="name-section">
      <label class="field-label" for="rule-name-input">룰 이름</label>
      <input
        id="rule-name-input"
        type="text"
        class="name-input"
        :value="ruleName"
        placeholder="룰 이름을 입력하세요"
        @input="emit('update:ruleName', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- 바로 활성화 -->
    <label class="activate-toggle">
      <input type="checkbox" :checked="activateNow"
        @change="emit('update:activateNow', ($event.target as HTMLInputElement).checked)" />
      <span>룰을 바로 활성화하기</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WizardStateV2, WizardStep } from './types'
import type { HouseGroup } from '@/types/group.types'
import type { Device } from '@/types/device.types'

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function dayLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 7) return '매일'
  if (JSON.stringify(sorted) === '[1,2,3,4,5]') return '매주 평일'
  if (JSON.stringify(sorted) === '[0,6]') return '매주 주말'
  return '매주 ' + sorted.map(d => DAY_NAMES[d]).join('·')
}

function fmt12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const suffix = h < 12 ? '오전' : '오후'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${suffix} ${h12}:${mStr}`
}

const props = defineProps<{
  state: WizardStateV2
  groups: HouseGroup[]
  devices: Device[]
  ruleName: string
  activateNow: boolean
}>()

const emit = defineEmits<{
  'update:ruleName': [v: string]
  'update:activateNow': [v: boolean]
  'jump-to': [step: WizardStep]
  save: []
}>()

const groupName = computed(() => {
  const g = props.groups.find(g => g.id === props.state.groupId)
  return g?.name ?? '농장'
})

const intentIcon = computed(() => {
  switch (props.state.intent) {
    case 'irrigation': return '💧'
    case 'opener':     return '🚪'
    case 'fan':        return '🌀'
    default:           return '⚙️'
  }
})

const deviceStep = computed((): WizardStep => {
  return props.state.intent === 'irrigation' ? 'irrigation-valve' : 'device-by-intent'
})

const deviceSectionTitle = computed(() => {
  switch (props.state.intent) {
    case 'irrigation': return '밸브'
    case 'opener':     return '개폐기'
    case 'fan':        return '환풍기'
    default:           return '장치'
  }
})

const deviceText = computed(() => {
  const { state } = props
  if (state.intent === 'irrigation' && state.irrigation) {
    const zones = state.irrigation.valveZones.map(z => `${z}번 밸브`).join(', ')
    const fert = state.irrigation.useFertilizer ? '\n액비를 섞어서' : ''
    const dur = `${state.irrigation.durationMin}분간 관수`
    return `${zones}${fert ? '\n' + fert : ''}\n${dur}`
  }
  const trigger = state.intent === 'opener' ? state.opener : state.fan
  if (!trigger) return '(미선택)'
  const devNames = trigger.deviceIds.map(id => {
    const d = props.devices.find(x => x.id === id)
    return d?.name ?? id
  }).join(', ')
  return devNames
})

const timingText = computed(() => {
  const { state } = props
  if (state.intent === 'irrigation' && state.irrigation) {
    return state.irrigation.schedule.map((s, i) => {
      const day = dayLabel(s.days)
      const time = fmt12(s.startTime)
      return `${i > 0 ? '\n' : ''}${day} ${time}에 시작`
    }).join('')
  }
  const trigger = state.intent === 'opener' ? state.opener : state.fan
  if (!trigger) return '(미설정)'
  if (trigger.triggerType === 'time' && trigger.timeRange) {
    const day = dayLabel(trigger.timeRange.days)
    const action = state.intent === 'opener' ? '열어두고\n그 외 시간엔 닫습니다.' : '켜두고\n그 외 시간엔 끕니다.'
    return `${day} ${fmt12(trigger.timeRange.start)} ~ ${fmt12(trigger.timeRange.end)} 사이에 ${action}`
  }
  if (trigger.triggerType === 'temperature' && trigger.temperature) {
    const { base, hysteresis } = trigger.temperature
    const onAt = base + hysteresis
    const offAt = base - hysteresis
    const onAction = state.intent === 'opener' ? '열고' : '켜고'
    const offAction = state.intent === 'opener' ? '닫습니다' : '끕니다'
    return `온도가 ${onAt}°C 이상이면 ${onAction},\n${offAt}°C 이하로 떨어지면 ${offAction}.\n(기준 ${base}°C, 편차 ${hysteresis}°C)`
  }
  return '(미설정)'
})
</script>

<style scoped>
.step-review { display: flex; flex-direction: column; gap: 18px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }

.summary-card {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  overflow: hidden;
  background: var(--bg-card);
}
.summary-section {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 14px 16px;
}
.summary-section.clickable { cursor: pointer; transition: background 0.12s; }
.summary-section.clickable:hover { background: var(--bg-secondary); }
.summary-section.clickable:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }

.section-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.section-body { flex: 1; }
.section-text { font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary); flex: 1; line-height: 1.6; }
.edit-hint { font-size: calc(12px * var(--content-scale, 1)); color: var(--color-primary); flex-shrink: 0; margin-top: 2px; }

.divider { height: 1px; background: var(--border-color); margin: 0; }

.name-section { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: calc(14px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.name-input {
  padding: 10px 14px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-secondary); color: var(--text-primary);
  font-size: calc(15px * var(--content-scale, 1));
  width: 100%; box-sizing: border-box;
}
.name-input:focus { outline: none; border-color: var(--color-primary); }

.activate-toggle {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary);
}
.activate-toggle input { width: 18px; height: 18px; cursor: pointer; accent-color: var(--color-primary); }
</style>
