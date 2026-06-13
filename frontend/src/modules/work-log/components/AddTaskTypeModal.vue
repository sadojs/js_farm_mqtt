<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h3>{{ isEdit ? '작업 종류 편집' : '작업 종류 추가' }}</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="닫기">&times;</button>
      </div>
      <div class="modal-body">
        <div class="preview">
          <span class="preview-chip" :style="{ background: form.color + '22' }">
            <span class="preview-emoji">{{ form.emoji }}</span>
          </span>
          <div>
            <div class="preview-label">{{ form.label || '작업 이름' }}</div>
            <div class="preview-sub">미리보기</div>
          </div>
        </div>

        <div class="form-group">
          <label>작업 이름</label>
          <input v-model="form.label" type="text" maxlength="40" placeholder="예: 곁순 정리" class="form-input" />
        </div>

        <div class="form-group">
          <label>이모지 선택 <span class="sub-label">(타이핑 없이 탭하세요)</span></label>
          <div class="palette emoji-palette">
            <button
              v-for="e in palette.emoji"
              :key="e"
              type="button"
              :class="['palette-item', 'emoji-item', { selected: form.emoji === e }]"
              @click="form.emoji = e"
              :aria-label="e"
            >{{ e }}</button>
          </div>
        </div>

        <div class="form-group">
          <label>색 선택</label>
          <div class="palette color-palette">
            <button
              v-for="c in palette.color"
              :key="c"
              type="button"
              :class="['palette-item', 'color-item', { selected: form.color === c }]"
              :style="{ background: c }"
              @click="form.color = c"
              :aria-label="c"
            ></button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" @click="$emit('close')">취소</button>
        <button class="btn-primary" :disabled="!canSave || saving" @click="save">
          {{ saving ? '저장 중...' : '저장' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { workLogApi } from '../api/work-log.api'
import type { Palette, WorkTaskType } from '../types/work-log.types'

const props = defineProps<{
  palette: Palette
  initial?: WorkTaskType | null
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const isEdit = computed(() => !!props.initial?.id)

const form = ref({
  label: props.initial?.label ?? '',
  emoji: props.initial?.emoji ?? (props.palette.emoji[0] ?? '🍃'),
  color: props.initial?.color ?? (props.palette.color[0] ?? '#43a047'),
})

const saving = ref(false)
const canSave = computed(() => form.value.label.trim().length > 0 && !!form.value.emoji && !!form.value.color)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    const dto = {
      label: form.value.label.trim(),
      emoji: form.value.emoji,
      color: form.value.color,
    }
    if (isEdit.value && props.initial) {
      await workLogApi.updateTaskType(props.initial.id, dto)
    } else {
      await workLogApi.createTaskType(dto)
    }
    emit('saved')
  } catch (err: any) {
    alert(err.response?.data?.message || '저장 실패')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.modal-card {
  background: var(--bg-card);
  border-radius: 16px;
  max-width: 480px;
  width: 100%;
  border: 1px solid var(--border-card);
  max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-light);
}
.modal-header h3 { margin: 0; font-size: 18px; color: var(--text-primary); font-weight: 700; }
.modal-close {
  background: none; border: none;
  font-size: 24px; cursor: pointer;
  color: var(--text-muted); line-height: 1;
}
.modal-body {
  padding: 20px 22px;
  overflow-y: auto;
  display: flex; flex-direction: column;
  gap: 18px;
}

.preview {
  display: flex; align-items: center; gap: 12px;
  padding: 14px;
  background: var(--bg-secondary, var(--bg-hover));
  border: 1px solid var(--border-light);
  border-radius: 12px;
}
.preview-chip {
  width: 48px; height: 48px;
  border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.preview-emoji { font-size: 24px; }
.preview-label { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.preview-sub { font-size: 11px; color: var(--text-muted); }

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.sub-label { font-weight: 400; color: var(--text-muted); }
.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary, var(--bg-card));
  color: var(--text-primary);
  font-size: 14px;
  box-sizing: border-box;
}
.form-input:focus { outline: none; border-color: var(--accent); }

.palette {
  display: grid;
  gap: 8px;
}
.emoji-palette {
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
}
.color-palette {
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
}
.palette-item {
  width: 44px; height: 44px;
  border-radius: 10px;
  border: 2px solid transparent;
  background: var(--bg-hover);
  cursor: pointer;
  font-size: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, border-color 0.15s;
}
.palette-item:hover { transform: translateY(-1px); }
.palette-item.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(76,175,80,0.18);
}
.color-item { color: transparent; }

.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 16px 22px;
  border-top: 1px solid var(--border-light);
}
.btn-ghost, .btn-primary {
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-ghost {
  background: transparent; color: var(--text-primary);
  border-color: var(--border-color);
}
.btn-primary {
  background: var(--accent); color: #fff; border: none;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
