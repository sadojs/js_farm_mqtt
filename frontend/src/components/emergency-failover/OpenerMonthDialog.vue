<script setup lang="ts">
import { ref, watch } from 'vue'
import type { OpenerSchedule, UpsertScheduleDto } from '../../types/emergency-failover.types'

const props = defineProps<{
  open: boolean
  month: number
  initial: OpenerSchedule | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', dto: UpsertScheduleDto): void
}>()

const enabled = ref(false)
const mode = ref<'time' | 'always-open'>('time')
const openTime = ref('09:00')
const closeTime = ref('17:00')

watch(
  () => props.open,
  (v) => {
    if (v) {
      enabled.value = props.initial?.enabled ?? false
      mode.value = props.initial?.mode ?? 'time'
      // DB값이 'HH:mm:ss' 또는 'HH:mm' 모두 대응
      openTime.value = (props.initial?.openTime ?? '09:00').slice(0, 5)
      closeTime.value = (props.initial?.closeTime ?? '17:00').slice(0, 5)
    }
  },
)

// time input은 브라우저에 따라 HH:mm:ss를 반환할 수 있음.
// 백엔드 DTO는 HH:mm만 허용하므로 5글자로 정규화.
function normalizeTime(v: string): string {
  return v?.slice(0, 5) ?? v
}

function save() {
  emit('save', {
    enabled: enabled.value,
    mode: mode.value,
    openTime: mode.value === 'time' ? normalizeTime(openTime.value) : undefined,
    closeTime: mode.value === 'time' ? normalizeTime(closeTime.value) : undefined,
  })
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-header">
        <h3>{{ month }}월 폴백 스케줄</h3>
        <button class="close-btn" @click="emit('close')">×</button>
      </header>
      <div class="modal-body">
        <label class="checkbox-row">
          <input type="checkbox" v-model="enabled" />
          <span>이 월 활성화</span>
        </label>

        <div class="form-group">
          <label>모드</label>
          <div class="radio-row">
            <label>
              <input type="radio" value="time" v-model="mode" />
              시간 기반
            </label>
            <label>
              <input type="radio" value="always-open" v-model="mode" />
              24시간 OPEN
            </label>
          </div>
        </div>

        <div v-if="mode === 'time'" class="time-inputs">
          <div class="form-group">
            <label>OPEN 시각</label>
            <input type="time" v-model="openTime" />
          </div>
          <div class="form-group">
            <label>CLOSE 시각</label>
            <input type="time" v-model="closeTime" />
          </div>
        </div>

        <p class="hint">
          ⓘ 통신 단절 시에만 이 스케줄이 동작합니다. 정상 통신 중에는 서버 자동화 룰을 따릅니다.
        </p>
      </div>
      <footer class="modal-footer">
        <button class="btn-secondary" @click="emit('close')">취소</button>
        <button class="btn-primary" @click="save">저장</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: var(--card-bg, #fff); border-radius: 12px;
  width: 90%; max-width: 420px; max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0,0,0,0.15);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e5e5e5);
}
.modal-header h3 { margin: 0; font-size: 18px; }
.close-btn {
  background: none; border: none; font-size: 24px; cursor: pointer;
  color: var(--text-secondary, #666);
}
.modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.checkbox-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-weight: 500; font-size: 14px; }
.radio-row { display: flex; gap: 16px; }
.radio-row label { display: flex; align-items: center; gap: 6px; font-weight: normal; }
.time-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
input[type="time"] {
  padding: 8px; border: 1px solid var(--border-color, #ccc);
  border-radius: 6px; font-size: 14px;
}
.hint {
  background: var(--info-bg, #f0f4f8); color: var(--text-secondary, #555);
  padding: 8px 12px; border-radius: 6px; font-size: 13px; margin: 0;
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px; border-top: 1px solid var(--border-color, #e5e5e5);
}
.btn-primary, .btn-secondary {
  padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px;
  border: 1px solid transparent;
}
.btn-primary { background: var(--primary, #4caf50); color: #fff; }
.btn-secondary {
  background: var(--card-bg, #fff); color: var(--text, #333);
  border-color: var(--border-color, #ccc);
}
</style>
