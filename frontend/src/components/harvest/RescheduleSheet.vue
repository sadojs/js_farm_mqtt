<template>
  <div class="sheet-overlay" @click.self="$emit('close')">
    <div class="sheet-content">
      <h3>{{ occurrence.taskName }} 작업 완료</h3>

      <!-- 생육 피드백 (유연 간격 작업인 경우) -->
      <div v-if="showFeedback" class="feedback-section">
        <p class="sheet-label">현재 생육 상태는 어떤가요?</p>
        <div class="feedback-options">
          <label v-for="fb in GROWTH_FEEDBACK" :key="fb.value"
            :class="['feedback-card', { selected: selectedFeedback === fb.value }]">
            <input type="radio" v-model="selectedFeedback" :value="fb.value" />
            <span class="feedback-icon">{{ fb.icon }}</span>
            <span class="feedback-label">{{ fb.label }}</span>
            <span class="feedback-desc">{{ fb.description }}</span>
          </label>
        </div>
      </div>

      <!-- 재스케줄 옵션 -->
      <p class="sheet-label">
        <template v-if="dayDiff !== 0">
          {{ Math.abs(dayDiff) }}일 {{ dayDiff > 0 ? '빨리' : '늦게' }} 완료했습니다. 이후 일정은?
        </template>
        <template v-else>
          이후 일정은 어떻게 할까요?
        </template>
      </p>

      <div class="reschedule-options">
        <label v-for="mode in RESCHEDULE_MODES" :key="mode.value"
          :class="['option-card', { selected: selectedMode === mode.value }]">
          <input type="radio" v-model="selectedMode" :value="mode.value" />
          <div class="option-body">
            <span class="option-label">
              {{ mode.label }}
              <span v-if="mode.recommended" class="badge-recommend">권장</span>
            </span>
            <span class="option-desc">{{ mode.description }}</span>
          </div>
        </label>
      </div>

      <label class="remember-toggle">
        <input type="checkbox" v-model="rememberChoice" />
        이 작업은 앞으로 항상 이 방식으로
      </label>

      <div class="sheet-actions">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <button class="btn-primary" @click="handleConfirm">완료</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RESCHEDULE_MODES, GROWTH_FEEDBACK } from '../../utils/task-presets'
import type { OccurrenceWithContext } from '../../api/harvest-task.api'

const props = defineProps<{
  occurrence: OccurrenceWithContext
  showFeedback?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [mode: string, remember: boolean, growthFeedback?: string]
}>()

const selectedMode = ref<string>('anchor')
const rememberChoice = ref(false)
const selectedFeedback = ref<string>('normal')

const dayDiff = computed(() => {
  const scheduled = new Date(props.occurrence.scheduledDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((scheduled.getTime() - today.getTime()) / 86400000)
})

function handleConfirm() {
  const feedback = props.showFeedback ? selectedFeedback.value : undefined
  emit('confirm', selectedMode.value, rememberChoice.value, feedback)
}
</script>

<style scoped>
.sheet-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay); display: flex; align-items: flex-end;
  justify-content: center; z-index: 400;
}
.sheet-content {
  background: var(--bg-card); border-radius: 16px 16px 0 0;
  padding: 28px 24px; width: 100%; max-width: 500px;
  max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-modal);
}
.sheet-content h3 { font-size: 1.1em; font-weight: 700; margin-bottom: 16px; color: var(--text-primary); }

.sheet-label { font-size: 0.9em; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5; font-weight: 500; }

/* 생육 피드백 */
.feedback-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light); }
.feedback-options { display: flex; gap: 8px; }
.feedback-card {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border: 2px solid var(--border-card); border-radius: 12px;
  cursor: pointer; transition: border-color 0.15s;
}
.feedback-card.selected { border-color: var(--accent); background: var(--accent-bg); }
.feedback-card input[type="radio"] { display: none; }
.feedback-icon { font-size: 1.4em; }
.feedback-label { font-weight: 600; font-size: 0.85em; color: var(--text-primary); }
.feedback-desc { font-size: 0.72em; color: var(--text-muted); text-align: center; }

/* 재스케줄 옵션 */
.reschedule-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
.option-card {
  display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
  border: 2px solid var(--border-card); border-radius: 12px;
  cursor: pointer; transition: border-color 0.15s;
}
.option-card.selected { border-color: var(--accent); background: var(--accent-bg); }
.option-card input[type="radio"] { margin-top: 2px; accent-color: var(--accent); }
.option-body { display: flex; flex-direction: column; gap: 4px; }
.option-label { font-weight: 600; font-size: 0.95em; color: var(--text-primary); }
.badge-recommend {
  display: inline-block; font-size: 0.7em; padding: 2px 6px;
  background: var(--accent); color: white; border-radius: 4px;
  margin-left: 6px; vertical-align: middle;
}
.option-desc { font-size: 0.82em; color: var(--text-muted); }

.remember-toggle {
  display: flex; align-items: center; gap: 8px; font-size: 0.88em;
  color: var(--text-secondary); margin-bottom: 20px; cursor: pointer;
}
.remember-toggle input[type="checkbox"] { accent-color: var(--accent); }

.sheet-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn-primary {
  padding: 10px 20px; background: var(--accent); color: white;
  border: none; border-radius: 8px; font-weight: 600; cursor: pointer;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-secondary {
  padding: 10px 20px; background: var(--bg-hover); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: 8px; font-weight: 500; cursor: pointer;
}

@media (min-width: 769px) {
  .sheet-overlay { align-items: center; }
  .sheet-content { border-radius: 16px; }
}
</style>
