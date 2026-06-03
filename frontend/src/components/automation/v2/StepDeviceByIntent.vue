<template>
  <div class="step-dev">
    <div class="step-head">
      <h3 class="step-title">{{ title }}</h3>
      <p class="step-desc">여러 개 선택 가능합니다</p>
    </div>

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
        <!-- 좌측 체크박스 -->
        <span class="check-box" :class="{ checked: modelValue.includes(d.id) }" aria-hidden="true">
          <svg v-if="modelValue.includes(d.id)" viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <!-- 장비 아이콘 칩 (선택 시 컬러) -->
        <EquipmentIcon
          :type="intent === 'opener' ? 'opener' : 'fan'"
          :active="modelValue.includes(d.id)"
          :size="20"
          :title="label"
        />
        <!-- 본문 -->
        <div class="device-info">
          <span class="device-name">{{ d.name }}</span>
          <span class="device-meta">
            {{ getEquipmentLabel(d, { openerPaired: false }) }}<template v-if="intent === 'opener' && d.openerGroupName"> · {{ d.openerGroupName }}</template>
          </span>
        </div>
      </label>
    </div>

    <!-- 안내 배너 (info 톤) -->
    <div class="hints">
      <p class="hint-info">
        <span class="hint-icon">ℹ️</span>
        다음 단계에서 설정한 {{ triggerHint }}이 만족되면
        {{ intent === 'opener' ? '열리고' : '켜지고' }},
        벗어나면 자동으로 {{ intent === 'opener' ? '닫힙니다.' : '꺼집니다.' }}
      </p>
      <p v-if="intent === 'opener'" class="hint-warn">
        <span class="hint-icon">⚠️</span>
        안전을 위해 열림/닫힘은 1초 간격으로 순차 동작합니다.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDeviceStore } from '@/stores/device.store'
import { useGroupStore } from '@/stores/group.store'
import EmptyState from '@/components/common/EmptyState.vue'
import EquipmentIcon from '@/components/common/EquipmentIcon.vue'
import type { WizardIntent } from './types'
import { getEquipmentLabel } from '@/utils/device-labels'

const props = defineProps<{
  intent: Extract<WizardIntent, 'opener' | 'fan'>
  groupId: string
  farmUserId?: string | null
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
  const byFarm = props.farmUserId
    ? groupDevices.filter((d: any) => !d.userId || d.userId === props.farmUserId)
    : groupDevices

  if (props.intent === 'opener') {
    return byFarm.filter(d => d.equipmentType === 'opener_open')
  }
  return byFarm.filter(d => d.equipmentType === 'fan')
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

.step-head { display: flex; flex-direction: column; gap: 4px; }
.step-title {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}
.step-desc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  margin: 0;
}

.loading-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.device-list { display: flex; flex-direction: column; gap: 10px; }

.device-card {
  display: flex; align-items: center; gap: 12px;
  min-height: 60px; padding: 12px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: 13px;
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.device-card:hover { border-color: var(--primary, var(--color-primary, #4caf50)); background: var(--bg-hover); }
.device-card:focus-within { outline: 2px solid var(--primary, #4caf50); outline-offset: 2px; }
.device-card.selected {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: color-mix(in srgb, var(--primary, #4caf50) 8%, var(--bg-card));
}

/* 좌측 체크박스 */
.check-box {
  width: 22px; height: 22px;
  border-radius: 6px;
  border: 1.5px solid var(--border-color);
  background: var(--bg-card);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
  color: #fff;
}
.check-box.checked {
  background: var(--primary, var(--color-primary, #4caf50));
  border-color: var(--primary, var(--color-primary, #4caf50));
}

.device-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.device-name {
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
}
.device-meta {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 안내 배너 (info / warn) */
.hints { display: flex; flex-direction: column; gap: 8px; }
.hint-info, .hint-warn {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: calc(13px * var(--content-scale, 1));
  padding: 12px 14px;
  border-radius: 10px;
  margin: 0;
  line-height: 1.5;
  border: 1px solid;
}
.hint-info {
  background: color-mix(in srgb, var(--primary, #4caf50) 6%, var(--bg-card));
  border-color: color-mix(in srgb, var(--primary, #4caf50) 25%, transparent);
  color: var(--text-primary);
}
.hint-warn {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.35);
  color: var(--text-primary);
}
.hint-icon { flex-shrink: 0; font-size: 14px; line-height: 1.4; }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
