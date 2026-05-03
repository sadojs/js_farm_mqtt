<template>
  <div class="step-device">
    <h3 class="step-title">어느 관수 장치를 사용할까요?</h3>

    <EmptyState
      v-if="!loading && controllers.length === 0"
      icon="device"
      title="관수 장치가 없습니다"
      description="장치 관리에서 관수 컨트롤러를 먼저 등록해주세요"
    />

    <div v-else-if="loading" class="loading-msg">장치 목록을 불러오는 중...</div>

    <div v-else class="device-list" role="radiogroup" aria-label="관수 장치 선택">
      <label
        v-for="ctrl in controllers"
        :key="ctrl.deviceId"
        class="device-card"
        :class="{ selected: modelValue === ctrl.deviceId }"
      >
        <input
          type="radio"
          :value="ctrl.deviceId"
          :checked="modelValue === ctrl.deviceId"
          class="sr-only"
          @change="handleSelect(ctrl)"
        />
        <div class="device-info">
          <div class="device-name-row">
            <span class="device-name">{{ ctrl.name }}</span>
            <span v-if="ctrl.canMixFertilizer" class="badge badge-fert">액비혼합 가능</span>
          </div>
          <span class="device-meta">{{ ctrl.channelCount }}채널 · {{ ctrl.groupName }}</span>
        </div>
        <span v-if="modelValue === ctrl.deviceId" class="check-mark" aria-hidden="true">✓</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useDeviceStore } from '@/stores/device.store'
import { useGroupStore } from '@/stores/group.store'
import { detectChannelCount } from '@/types/device.types'
import EmptyState from '@/components/common/EmptyState.vue'

interface ControllerInfo {
  deviceId: string
  name: string
  channelCount: 8 | 12
  canMixFertilizer: boolean
  groupName: string
}

const props = defineProps<{
  groupId: string
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [deviceId: string]
  select: [info: ControllerInfo]
  proceed: []
}>()

const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

const loading = computed(() => deviceStore.loading)

function getChannelCount(d: any): 8 | 12 {
  // 1. channelMapping 값에 switch_11/12가 있으면 12CH
  if (d.channelMapping) {
    const vals = Object.values(d.channelMapping as Record<string, string>)
    if (vals.some(v => v === 'switch_11' || v === 'switch_12')) return 12
    return 8
  }
  // 2. switchStates 키로 판단
  if (d.switchStates && Object.keys(d.switchStates).length > 0) {
    return detectChannelCount(Object.keys(d.switchStates))
  }
  // 3. 판단 불가 → 기본값 8 (status fetch 후 반응적 갱신됨)
  return 8
}

const controllers = computed<ControllerInfo[]>(() => {
  const group = groupStore.groups.find(g => g.id === props.groupId)
  const groupDevices: any[] = group?.devices ?? []
  const allDevices = deviceStore.devices

  const candidates = [...groupDevices, ...allDevices].reduce<any[]>((acc, d) => {
    if (!acc.find(x => x.id === d.id)) acc.push(d)
    return acc
  }, [])

  return candidates
    .filter(d => d.deviceType === 'actuator' && d.equipmentType === 'irrigation')
    .map(d => {
      const ch = getChannelCount(d)
      const grp = groupStore.groups.find(g => g.devices?.some((gd: any) => gd.id === d.id))
      return {
        deviceId: d.id,
        name: d.name,
        channelCount: ch,
        canMixFertilizer: ch === 12,
        groupName: grp?.name ?? '농장',
      } satisfies ControllerInfo
    })
})

function handleSelect(ctrl: ControllerInfo) {
  emit('update:modelValue', ctrl.deviceId)
  emit('select', ctrl)
  setTimeout(() => emit('proceed'), 200)
}

onMounted(async () => {
  if (deviceStore.devices.length === 0) await deviceStore.fetchDevices()

  const group = groupStore.groups.find(g => g.id === props.groupId)
  const groupDevices: any[] = group?.devices ?? []
  const allDevices = deviceStore.devices
  const candidates = [...groupDevices, ...allDevices].reduce<any[]>((acc, d) => {
    if (!acc.find((x: any) => x.id === d.id)) acc.push(d)
    return acc
  }, [])

  const needsFetch = candidates.filter(
    d => d.equipmentType === 'irrigation' &&
      !d.channelMapping &&
      (!d.switchStates || Object.keys(d.switchStates).length === 0)
  )
  await Promise.allSettled(needsFetch.map((d: any) => deviceStore.fetchDeviceStatus(d.id)))
})
</script>

<style scoped>
.step-device { display: flex; flex-direction: column; gap: 16px; }
.step-title { font-size: calc(17px * var(--content-scale, 1)); font-weight: 600; color: var(--text-primary); margin: 0; }
.loading-msg { color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); }

.device-list { display: flex; flex-direction: column; gap: 10px; }

.device-card {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 72px; padding: 14px 16px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.12));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.device-card:hover { border-color: var(--color-primary); background: var(--bg-secondary); }
.device-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card)); }
.device-card:focus-within { outline: 2px solid var(--color-primary); }

.device-info { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.device-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.device-name { font-size: calc(15px * var(--content-scale, 1)); font-weight: 500; color: var(--text-primary); }
.device-meta { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }

.badge { font-size: calc(11px * var(--content-scale, 1)); padding: 2px 8px; border-radius: 99px; font-weight: 600; }
.badge-fert { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
.check-mark { color: var(--color-primary); font-size: 18px; font-weight: 700; flex-shrink: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
</style>
