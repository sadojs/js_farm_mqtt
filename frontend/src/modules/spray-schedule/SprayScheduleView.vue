<template>
  <div class="spray-view">
    <header class="page-header">
      <div>
        <h2>방재일정</h2>
        <p class="page-description">{{ farmLabel }} · 전체 구역 통합 보기</p>
      </div>
      <div class="tabs">
        <button :class="['tab', { active: tab === 'calendar' }]" @click="tab = 'calendar'">방재 달력</button>
        <button :class="['tab', { active: tab === 'setup' }]" @click="tab = 'setup'">방재일정 설정</button>
      </div>
    </header>

    <section v-show="tab === 'calendar'">
      <div v-if="markers.length === 0" class="empty">
        <p>아직 방재 구역이 없습니다.</p>
        <button class="btn-primary" @click="tab = 'setup'">방재일정 설정하기</button>
      </div>
      <SprayCalendar
        v-else
        :events="events"
        :markers="markers"
        @move="onMoveRequest"
        @select="onSelect"
        @add-single="openManual"
      />
    </section>

    <section v-show="tab === 'setup'">
      <SpraySetup ref="setupRef" @changed="reloadCalendar" />
    </section>

    <!-- 선택된 이벤트 액션 -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="mini-modal">
        <h3 class="modal-title">{{ selected.zoneName }} · {{ selected.pest }}<template v-if="!selected.isManual"> {{ selected.round }}차</template></h3>
        <p class="mini-line">약품: {{ selected.product || '—' }}</p>
        <p class="mini-line">날짜: {{ shortDate(selected.date) }}</p>
        <p v-if="selected.note" class="mini-line">메모: {{ selected.note }}</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="openShift">일정 연기/당기기</button>
          <button class="btn-danger" @click="deleteSelected">일정 삭제</button>
          <button class="btn-ghost" @click="selected = null">닫기</button>
        </div>
      </div>
    </div>

    <MoveEventModal
      v-if="moveTarget"
      :event="moveTarget.ev"
      :target-date="moveTarget.date"
      @apply="applyMove"
      @cancel="moveTarget = null"
    />

    <ShiftEventModal
      v-if="shiftTarget"
      :event="shiftTarget"
      @apply="applyShift"
      @cancel="shiftTarget = null"
    />

    <ManualEventModal
      v-if="showManual"
      :zones="markers"
      :default-date="manualDate"
      @create="createManual"
      @cancel="showManual = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import { useNotificationStore } from '../../stores/notification.store'
import { sprayScheduleApi } from './api/spray-schedule.api'
import type {
  SprayEvent,
  ZoneMarker,
  MoveMode,
  CreateManualEventPayload,
} from './types/spray-schedule.types'
import { shortDate } from './utils/spray-schedule.utils'
import SpraySetup from './components/SpraySetup.vue'
import SprayCalendar from './components/SprayCalendar.vue'
import MoveEventModal from './components/MoveEventModal.vue'
import ShiftEventModal from './components/ShiftEventModal.vue'
import ManualEventModal from './components/ManualEventModal.vue'

const authStore = useAuthStore()
const notify = useNotificationStore()
const farmLabel = `${authStore.user?.name ?? '우리'} 농장`

const tab = ref<'calendar' | 'setup'>('calendar')
const events = ref<SprayEvent[]>([])
const markers = ref<ZoneMarker[]>([])
const setupRef = ref<InstanceType<typeof SpraySetup> | null>(null)

const selected = ref<SprayEvent | null>(null)
const moveTarget = ref<{ ev: SprayEvent; date: string } | null>(null)
const shiftTarget = ref<SprayEvent | null>(null)
const showManual = ref(false)
const manualDate = ref<string | undefined>(undefined)

async function reloadCalendar() {
  const [evs, mks] = await Promise.all([
    sprayScheduleApi.getEvents(),
    sprayScheduleApi.getZoneMarkers(),
  ])
  events.value = evs
  markers.value = mks
}

function onSelect(ev: SprayEvent) {
  selected.value = ev
}

function onMoveRequest(ev: SprayEvent, date: string) {
  moveTarget.value = { ev, date }
}

async function applyMove(mode: MoveMode) {
  if (!moveTarget.value) return
  const { ev, date } = moveTarget.value
  try {
    await sprayScheduleApi.moveEvent(ev.id, date, mode)
    notify.success('방재일정', '일정을 이동했습니다.')
    await reloadCalendar()
  } catch {
    notify.error('방재일정', '일정 이동에 실패했습니다.')
  } finally {
    moveTarget.value = null
  }
}

function openManual(date: string) {
  if (markers.value.length === 0) {
    notify.warning('방재일정', '먼저 구역을 추가해 주세요.')
    return
  }
  manualDate.value = date
  showManual.value = true
}

async function createManual(payload: CreateManualEventPayload) {
  try {
    await sprayScheduleApi.createManualEvent(payload)
    notify.success('방재일정', '단건 일정을 추가했습니다.')
    await reloadCalendar()
  } catch {
    notify.error('방재일정', '단건 일정 추가에 실패했습니다.')
  } finally {
    showManual.value = false
  }
}

function openShift() {
  if (!selected.value) return
  shiftTarget.value = selected.value
  selected.value = null
}

async function applyShift(payload: { newDate: string; mode: MoveMode }) {
  if (!shiftTarget.value) return
  const ev = shiftTarget.value
  try {
    await sprayScheduleApi.moveEvent(ev.id, payload.newDate, payload.mode)
    notify.success('방재일정', payload.mode === 'following' ? '이 일정과 이후 일정을 함께 조정했습니다.' : '일정을 조정했습니다.')
    await reloadCalendar()
  } catch {
    notify.error('방재일정', '일정 조정에 실패했습니다.')
  } finally {
    shiftTarget.value = null
  }
}

async function deleteSelected() {
  if (!selected.value) return
  try {
    await sprayScheduleApi.deleteEvent(selected.value.id)
    notify.info('방재일정', '일정을 삭제했습니다.')
    await reloadCalendar()
  } catch {
    notify.error('방재일정', '일정 삭제에 실패했습니다.')
  } finally {
    selected.value = null
  }
}

onMounted(reloadCalendar)
</script>

<style scoped>
.spray-view { display: flex; flex-direction: column; gap: 18px; }
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page-header h2 { font-size: var(--font-size-title); font-weight: 700; color: var(--text-primary); }
.page-description { color: var(--text-muted); }
.tabs { display: flex; gap: 4px; background: var(--bg-hover); border-radius: 10px; padding: 4px; }
.tab {
  border: none;
  background: none;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: var(--text-secondary);
}
.tab.active { background: var(--bg-card); color: var(--accent); box-shadow: var(--shadow-card); }
.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 600;
  cursor: pointer;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.mini-modal {
  background: var(--bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  padding: 22px;
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 700; color: var(--text-primary); }
.mini-line { color: var(--text-secondary); font-size: var(--font-size-label); }
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.modal-actions > button {
  white-space: nowrap;
  flex: 0 0 auto;
}
.btn-ghost {
  background: var(--bg-hover);
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
}
.btn-danger {
  background: var(--danger-bg);
  color: var(--danger);
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  cursor: pointer;
  font-weight: 600;
}
.btn-secondary {
  background: var(--accent-bg);
  color: var(--accent);
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  cursor: pointer;
  font-weight: 600;
}
.btn-secondary:hover { filter: brightness(0.97); }

/* 모바일: 모달 폭 확보 + 버튼 가로 전체 사용 */
@media (max-width: 480px) {
  .mini-modal {
    max-width: 100%;
    padding: 18px;
  }
  .modal-actions {
    flex-direction: column-reverse;
    gap: 8px;
  }
  .modal-actions > button {
    width: 100%;
    padding: 12px 16px;
  }
}
</style>
