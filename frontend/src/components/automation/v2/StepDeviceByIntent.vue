<template>
  <div class="step-dev">
    <h3 class="step-title">{{ title }}</h3>
    <p class="step-sub">여러 개 선택 가능해요</p>

    <EmptyState
      v-if="!loading && devices.length === 0"
      icon="device"
      :title="`등록된 ${label}이(가) 없습니다`"
      description="장치 관리에서 먼저 등록해주세요"
    />

    <div v-else-if="loading" class="loading-msg">장치 목록을 불러오는 중...</div>

    <div v-else class="device-list" role="group" :aria-label="`${label} 선택`">
      <label
        v-for="d in devices"
        :key="d.id"
        class="device-card"
        :class="{ selected: modelValue.includes(d.id) }"
        :aria-label="`${d.name} 선택`"
      >
        <input
          type="checkbox"
          :value="d.id"
          :checked="modelValue.includes(d.id)"
          class="sr-only"
          @change="toggle(d.id)"
        />
        <div class="device-info">
          <span class="device-name">{{ d.name }}</span>
          <span v-if="intent === 'opener' && d.openerGroupName" class="device-meta">{{ d.openerGroupName }}</span>
        </div>
        <span v-if="modelValue.includes(d.id)" class="check-icon" aria-hidden="true">✓</span>
      </label>
    </div>

    <!-- 안내 문구 -->
    <div class="hints">
      <p class="hint-info">
        ℹ️ 다음 단계에서 설정한 {{ triggerHint }}이 만족되면
        {{ intent === 'opener' ? '열리고' : '켜지고' }},
        벗어나면 자동으로 {{ intent === 'opener' ? '닫힙니다.' : '꺼집니다.' }}
      </p>
      <p v-if="intent === 'opener'" class="hint-warn">
        ⚠️ 안전을 위해 열림/닫힘은 1초 간격으로 순차 동작합니다.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDeviceStore } from '@/stores/device.store'
import { useGroupStore } from '@/stores/group.store'
import EmptyState from '@/components/common/EmptyState.vue'
import type { WizardIntent } from './types'

const props = defineProps<{
  intent: Extract<WizardIntent, 'opener' | 'fan'>
  groupId: string
  modelValue: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()

const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

const loading = computed(() => deviceStore.loading)

const label = computed(() => props.intent === 'opener' ? '개폐기' : '환풍기')
const title = computed(() => props.intent === 'opener' ? '어느 개폐기를 자동 제어할까요?' : '어떤 환풍기를 자동 제어할까요?')
const triggerHint = computed(() => '시간/온도 조건')

const devices = computed(() => {
  const group = groupStore.groups.find(g => g.id === props.groupId)
  const groupDevices: any[] = group?.devices ?? []
  const allDevices = deviceStore.devices

  const candidates = [...groupDevices, ...allDevices].reduce<any[]>((acc, d) => {
    if (!acc.find(x => x.id === d.id)) acc.push(d)
    return acc
  }, [])

  if (props.intent === 'opener') {
    return candidates.filter(d => d.equipmentType === 'opener_open')
  }
  return candidates.filter(d => d.equipmentType === 'fan')
})

function toggle(id: string) {
  const current = [...props.modelValue]
  const idx = current.indexOf(id)
  if (idx === -1) current.push(id)
  else current.splice(idx, 1)
  emit('update:modelValue', current)
}

onMounted(async () => {
  if (deviceStore.devices.length === 0) await deviceStore.fetchDevices()
})
</script>

<style scoped>
.step-dev { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }
.step-sub { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); margin: -10px 0 0; }
.loading-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.device-list { display: flex; flex-direction: column; gap: 8px; }

.device-card {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 60px; padding: 12px 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card); cursor: pointer;
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.12));
  transition: border-color 0.15s, background 0.15s;
}
.device-card:hover { border-color: var(--color-primary); background: var(--bg-secondary); }
.device-card:focus-within { outline: 2px solid var(--color-primary); }
.device-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card)); }

.device-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.device-name { font-size: calc(14px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.device-meta { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); }
.check-icon { color: var(--color-primary); font-size: 16px; font-weight: 700; flex-shrink: 0; }

.hints { display: flex; flex-direction: column; gap: 8px; }
.hint-info, .hint-warn {
  font-size: calc(13px * var(--content-scale, 1)); padding: 10px 12px;
  border-radius: var(--radius-sm, 6px); margin: 0; line-height: 1.5;
}
.hint-info { background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-secondary)); color: var(--text-primary); }
.hint-warn { background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, var(--bg-secondary)); color: var(--text-primary); }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
