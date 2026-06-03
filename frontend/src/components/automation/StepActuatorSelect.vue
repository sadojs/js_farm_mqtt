<template>
  <div class="step-actuator">
    <div class="step-head">
      <h3 class="step-title">장치 선택</h3>
      <p class="step-desc">조건에 맞으면 제어할 장치를 선택하세요</p>
    </div>

    <div v-if="actuators.length === 0 && openers.length === 0" class="empty-msg">
      선택한 구역에 제어 가능한 장치가 없습니다.
    </div>
    <template v-else>
      <!-- 개폐기 (단일 선택, opener_open이 대표 ID) -->
      <div v-if="openers.length > 0" class="device-section">
        <div class="section-label">
          <span class="section-label-text">개폐기</span>
          <span class="section-count">{{ openers.length }}</span>
        </div>
        <div class="device-list">
          <button
            v-for="device in openers"
            :key="device.id"
            type="button"
            class="device-card"
            :class="{ selected: selectedIds.includes(device.id) }"
            role="radio"
            :aria-checked="selectedIds.includes(device.id)"
            @click="selectOther(device.id)"
          >
            <!-- 좌측: 라디오 원 -->
            <span class="radio-mark" :class="{ checked: selectedIds.includes(device.id) }" aria-hidden="true">
              <svg v-if="selectedIds.includes(device.id)" viewBox="0 0 24 24" width="14" height="14" fill="none"
                stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <!-- 장비 아이콘 칩 (개폐기 = 주황) -->
            <EquipmentIcon
              type="opener"
              :active="selectedIds.includes(device.id)"
              :size="20"
              title="개폐기"
            />
            <!-- 본문 -->
            <div class="device-info">
              <div class="device-name">{{ openerDisplayName(device) }}</div>
              <div class="device-meta">
                <span class="category">{{ getEquipmentLabel(device, { openerPaired: false }) }}</span>
                <span class="status-badge" :class="{ online: device.online }">
                  <span class="status-dot" :class="{ online: device.online }"></span>
                  {{ device.online ? '온라인' : '오프라인' }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- 휀 그룹 (멀티 선택) -->
      <div v-if="fans.length > 0" class="device-section">
        <div class="section-label">
          <span class="section-label-text">환풍기</span>
          <span class="section-count">{{ fans.length }}</span>
          <span class="multi-badge">복수 선택 가능</span>
        </div>
        <div class="device-list">
          <button
            v-for="device in fans"
            :key="device.id"
            type="button"
            class="device-card"
            :class="{ selected: selectedIds.includes(device.id) }"
            :aria-pressed="selectedIds.includes(device.id)"
            @click="toggleFan(device.id)"
          >
            <!-- 좌측: 체크박스 -->
            <span class="check-box" :class="{ checked: selectedIds.includes(device.id) }" aria-hidden="true">
              <svg v-if="selectedIds.includes(device.id)" viewBox="0 0 24 24" width="13" height="13" fill="none"
                stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <!-- 장비 아이콘 칩 (환풍기 = 파랑) -->
            <EquipmentIcon
              type="fan"
              :active="selectedIds.includes(device.id)"
              :size="20"
              title="환풍기"
            />
            <!-- 본문 -->
            <div class="device-info">
              <div class="device-name">{{ device.name }}</div>
              <div class="device-meta">
                <span class="category">{{ getEquipmentLabel(device, { openerPaired: false }) }}</span>
                <span class="status-badge" :class="{ online: device.online }">
                  <span class="status-dot" :class="{ online: device.online }"></span>
                  {{ device.online ? '온라인' : '오프라인' }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- 기타 장치 (단일 선택) -->
      <div v-if="others.length > 0" class="device-section">
        <div v-if="fans.length > 0" class="section-label">
          <span class="section-label-text">기타 장치</span>
          <span class="section-count">{{ others.length }}</span>
        </div>
        <div class="device-list">
          <button
            v-for="device in others"
            :key="device.id"
            type="button"
            class="device-card"
            :class="{ selected: selectedIds.includes(device.id) }"
            role="radio"
            :aria-checked="selectedIds.includes(device.id)"
            @click="selectOther(device.id)"
          >
            <!-- 좌측: 라디오 원 -->
            <span class="radio-mark" :class="{ checked: selectedIds.includes(device.id) }" aria-hidden="true">
              <svg v-if="selectedIds.includes(device.id)" viewBox="0 0 24 24" width="14" height="14" fill="none"
                stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <!-- 장비 아이콘 칩 (equipment 별 색상 자동, irrigation은 cyan 등) -->
            <EquipmentIcon
              :type="device.equipmentType"
              :active="selectedIds.includes(device.id)"
              :size="20"
              :title="device.equipmentType ?? '기타'"
            />
            <!-- 본문 -->
            <div class="device-info">
              <div class="device-name">{{ device.name }}</div>
              <div class="device-meta">
                <span class="category">{{ getEquipmentLabel(device, { openerPaired: false }) }}</span>
                <span class="status-badge" :class="{ online: device.online }">
                  <span class="status-dot" :class="{ online: device.online }"></span>
                  {{ device.online ? '온라인' : '오프라인' }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGroupStore } from '../../stores/group.store'
import { getEquipmentLabel } from '@/utils/device-labels'
import EquipmentIcon from '@/components/common/EquipmentIcon.vue'

const props = defineProps<{
  selectedIds: string[]
  groupId?: string
  hideIrrigation?: boolean
  includeOpener?: boolean
}>()
const emit = defineEmits<{
  'update:selectedIds': [value: string[]]
}>()

const groupStore = useGroupStore()

const allDevices = computed(() => {
  if (!props.groupId) return []
  const group = groupStore.groups.find(g => g.id === props.groupId)
  if (!group) return []
  return (group.devices || []) as any[]
})

const actuators = computed(() =>
  allDevices.value.filter((d: any) =>
    d.deviceType === 'actuator' &&
    d.equipmentType !== 'opener_open' &&
    d.equipmentType !== 'opener_close' &&
    !(props.hideIrrigation && d.equipmentType === 'irrigation')
  )
)

const openers = computed(() =>
  props.includeOpener
    ? allDevices.value.filter((d: any) => d.deviceType === 'actuator' && d.equipmentType === 'opener_open')
    : []
)

const fans = computed(() => actuators.value.filter((d: any) => d.equipmentType === 'fan'))
const others = computed(() => actuators.value.filter((d: any) => d.equipmentType !== 'fan'))

function openerDisplayName(device: any): string {
  // "○○ 열기" → "○○" (페어 대표명 단순화)
  const name = device.name as string | undefined
  if (!name) return device.id
  return name.replace(/\s*열기\s*$/, '').trim() || name
}

function toggleFan(deviceId: string) {
  const current = props.selectedIds.filter(id => fans.value.some((f: any) => f.id === id))
  const idx = current.indexOf(deviceId)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(deviceId)
  }
  emit('update:selectedIds', current)
}

function selectOther(deviceId: string) {
  emit('update:selectedIds', [deviceId])
}
</script>

<style scoped>
.step-actuator { display: flex; flex-direction: column; gap: 20px; }

.step-head { display: flex; flex-direction: column; gap: 4px; }
.step-title {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0;
}
.step-desc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  margin: 0;
}

.empty-msg {
  text-align: center; padding: 32px; color: var(--text-muted);
  font-size: calc(14px * var(--content-scale, 1));
}

.device-section { display: flex; flex-direction: column; gap: 10px; }

/* 섹션 헤더 — '개폐기 1', '환풍기 3 [복수 선택 가능]' 톤 */
.section-label {
  display: flex; align-items: center; gap: 8px;
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  padding-left: 2px;
}
.section-label-text {}
.section-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; padding: 1px 7px;
  border-radius: 9px;
  background: var(--bg-hover);
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.multi-badge {
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  color: #1976d2;
  background: rgba(25, 118, 210, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}

.device-list { display: flex; flex-direction: column; gap: 10px; }

/* W2 카드 톤 — primary border + 8% bg */
.device-card {
  display: flex; align-items: center; gap: 12px;
  min-height: 64px;
  padding: 12px 14px;
  border: 1.5px solid var(--border-color);
  border-radius: 13px;
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: border-color 0.15s, background 0.15s;
}
.device-card:hover {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: var(--bg-hover);
}
.device-card.selected {
  border-color: var(--primary, var(--color-primary, #4caf50));
  background: color-mix(in srgb, var(--primary, #4caf50) 8%, var(--bg-card));
}
.device-card:focus-visible {
  outline: 2px solid var(--primary, #4caf50);
  outline-offset: 2px;
}

/* 좌측 라디오 원 */
.radio-mark {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--border-color);
  background: var(--bg-card);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  color: #fff;
  transition: all 0.15s;
}
.radio-mark.checked {
  background: var(--primary, var(--color-primary, #4caf50));
  border-color: var(--primary, var(--color-primary, #4caf50));
}

/* 좌측 체크박스 */
.check-box {
  width: 22px; height: 22px;
  border-radius: 6px;
  border: 1.5px solid var(--border-color);
  background: var(--bg-card);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  color: #fff;
  transition: all 0.15s;
}
.check-box.checked {
  background: var(--primary, var(--color-primary, #4caf50));
  border-color: var(--primary, var(--color-primary, #4caf50));
}

/* 본문 */
.device-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.device-name {
  font-size: calc(15px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.device-meta {
  display: flex; gap: 8px; align-items: center;
  flex-wrap: wrap;
}
.category {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
}

/* 온라인/오프라인 배지 — Groups.vue와 동일 톤 */
.status-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: calc(11px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  padding: 1px 8px 1px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
}
.status-badge.online {
  color: #15803d;
  background: rgba(34, 197, 94, 0.12);
}
.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status-dot.online {
  background: #22c55e;
}
</style>
