<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h3>🌱 파종 정보 입력</h3>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>

      <form @submit.prevent="handleSubmit" class="crop-form">
        <!-- 그룹 선택 -->
        <div class="form-group" v-if="groups.length > 0">
          <label>하우스 (구역)</label>
          <select v-model="form.groupId">
            <option value="">-- 선택 안함 --</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <!-- 작물 종류 -->
        <div class="form-group">
          <label>작물 종류 <span class="required">*</span></label>
          <select v-model="form.cropType" required @change="onCropTypeChange">
            <option value="">-- 선택 --</option>
            <option value="tomato">토마토</option>
            <option value="cherry_tomato">방울토마토</option>
            <option value="cucumber">오이</option>
            <option value="strawberry">딸기</option>
            <option value="paprika">파프리카</option>
          </select>
        </div>

        <!-- 묘 타입 -->
        <div class="form-group">
          <label>묘 타입 <span class="required">*</span></label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" v-model="form.seedlingType" value="seedling" required @change="onSeedlingTypeChange" />
              실생묘
            </label>
            <label class="radio-label">
              <input type="radio" v-model="form.seedlingType" value="grafted" @change="onSeedlingTypeChange" />
              접목묘
            </label>
          </div>
        </div>

        <!-- 파종일 -->
        <div class="form-group">
          <label>파종일 <span class="required">*</span></label>
          <input type="date" v-model="form.sowingDate" required />
        </div>

        <!-- 정식일 -->
        <div class="form-group">
          <label>정식일</label>
          <input
            type="date"
            v-model="form.transplantDate"
            :min="form.sowingDate"
          />
          <span class="hint">비워두면 자동으로 파종일 기준으로 계산됩니다.</span>
        </div>

        <!-- 기준온도 -->
        <div class="form-group">
          <label>기준온도 (°C)</label>
          <input type="number" v-model.number="form.baseTemp" step="0.5" min="0" max="20" />
          <span class="hint">묘 타입 선택 시 자동 적용 — 실생묘 10°C / 접목묘 8°C (토마토 기준)</span>
        </div>

        <!-- 온도 소스 -->
        <div class="form-group">
          <label>온도 소스</label>
          <select v-model="form.tempSource">
            <option value="auto">자동 (실내 센서 우선)</option>
            <option value="sensor">실내 센서 강제</option>
            <option value="weather">기상청 강제</option>
          </select>
          <span class="hint">
            실내 센서가 없으면 기상청 외기 온도에 하우스 보정값을 더해 계산합니다.
          </span>
        </div>

        <!-- 오프셋 설정 (센서 강제가 아닐 때) -->
        <div class="form-group" v-if="form.tempSource !== 'sensor'">
          <label>하우스 보정값 (°C) <span class="default-badge">기본 +8°C</span></label>
          <div class="offset-row">
            <input
              type="number"
              v-model.number="form.greenhouseOffset"
              step="0.1"
              min="-10"
              max="30"
              placeholder="미설정 시 +8°C 자동 적용"
            />
            <button
              type="button"
              class="btn-suggest"
              @click="loadOffsetSuggestions"
              :disabled="!form.groupId && !form.cropType"
            >
              추천값 보기
            </button>
          </div>

          <!-- 차용 후보 -->
          <div v-if="offsetSuggestions" class="offset-suggestions">
            <div v-if="offsetSuggestions.otherGroups.length > 0">
              <p class="suggestion-title">내 다른 하우스:</p>
              <button
                v-for="og in offsetSuggestions.otherGroups"
                :key="og.groupId"
                type="button"
                class="btn-offset-chip"
                @click="applyOffset(og.offset, 'borrowed', og.groupId)"
              >
                {{ og.groupName }} (+{{ og.offset }}°C)
              </button>
            </div>
            <div v-if="offsetSuggestions.communityAverage">
              <p class="suggestion-title">
                커뮤니티 평균 ({{ offsetSuggestions.communityAverage.sampleCount }}건):
              </p>
              <button
                type="button"
                class="btn-offset-chip community"
                @click="applyOffset(offsetSuggestions.communityAverage!.offset, 'community', undefined)"
              >
                +{{ offsetSuggestions.communityAverage.offset }}°C 적용
              </button>
            </div>
          </div>
        </div>

        <!-- 메모 -->
        <div class="form-group">
          <label>메모</label>
          <textarea v-model="form.notes" rows="2" placeholder="품종명 등 기타 정보"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-cancel" @click="$emit('close')">취소</button>
          <button type="submit" class="btn-submit" :disabled="submitting">
            {{ submitting ? '저장 중...' : '저장' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { cropManagementApi } from './api/crop-management.api'
import type { CreateCropBatchPayload, OffsetSuggestion } from './types/crop-management.types'

const CROP_BASE_TEMP: Record<string, Record<string, number>> = {
  seedling: { tomato: 10, cherry_tomato: 10, cucumber: 12, strawberry: 5, paprika: 10 },
  grafted:  { tomato:  8, cherry_tomato:  8, cucumber: 10, strawberry: 3, paprika:  8 },
}

const props = defineProps<{
  groups: Array<{ id: string; name: string }>
  initialGroupId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', batch: any): void
}>()

const today = new Date().toISOString().split('T')[0]

const form = reactive<CreateCropBatchPayload & { transplantDate?: string; notes?: string }>({
  groupId: props.initialGroupId ?? '',
  cropType: '' as any,
  seedlingType: 'seedling',
  sowingDate: today,
  transplantDate: '',
  baseTemp: 10,
  tempSource: 'auto',
  greenhouseOffset: undefined,
  notes: '',
})

const submitting = ref(false)
const offsetSuggestions = ref<OffsetSuggestion | null>(null)

function syncBaseTemp() {
  const type = form.seedlingType ?? 'seedling'
  form.baseTemp = CROP_BASE_TEMP[type]?.[form.cropType] ?? (type === 'grafted' ? 8 : 10)
}

function onCropTypeChange() {
  syncBaseTemp()
}

function onSeedlingTypeChange() {
  syncBaseTemp()
}

async function loadOffsetSuggestions() {
  if (!form.groupId || !form.cropType) return
  try {
    offsetSuggestions.value = await cropManagementApi.getOffsetSuggestions(
      form.groupId,
      form.cropType,
    )
  } catch {
    // 오류 무시
  }
}

function applyOffset(offset: number, source: string, borrowedGroupId?: string) {
  form.greenhouseOffset = offset
  ;(form as any).offsetSource = source
  ;(form as any).borrowedGroupId = borrowedGroupId ?? null
}

async function handleSubmit() {
  submitting.value = true
  try {
    const payload: CreateCropBatchPayload = {
      ...form,
      groupId: form.groupId || undefined,
      transplantDate: (form as any).transplantDate || undefined,
      notes: (form as any).notes || undefined,
    }
    const created = await cropManagementApi.createBatch(payload)
    emit('created', created)
    emit('close')
  } catch (e: any) {
    alert(e?.response?.data?.message ?? '저장 실패. 다시 시도해주세요.')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.modal-content {
  background: var(--card-bg, #fff);
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #eee);
  position: sticky;
  top: 0;
  background: var(--card-bg, #fff);
  z-index: 1;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary, #888);
  padding: 4px 8px;
}

.crop-form {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.required {
  color: var(--danger-color, #f44336);
}

.form-group select,
.form-group input[type="date"],
.form-group input[type="number"],
.form-group textarea {
  padding: 9px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.hint {
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.default-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 8px;
  margin-left: 6px;
  vertical-align: middle;
}

.radio-group {
  display: flex;
  gap: 16px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}

.offset-row {
  display: flex;
  gap: 8px;
}

.offset-row input {
  flex: 1;
}

.btn-suggest {
  padding: 8px 12px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-suggest:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.offset-suggestions {
  padding: 10px 12px;
  background: var(--input-bg, #f5f5f5);
  border-radius: 8px;
  font-size: 13px;
}

.suggestion-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  font-weight: 500;
}

.btn-offset-chip {
  padding: 4px 10px;
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #a5d6a7;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  margin: 2px;
}

.btn-offset-chip.community {
  background: #e3f2fd;
  color: #1565c0;
  border-color: #90caf9;
}

.form-actions {
  display: flex;
  gap: 10px;
  padding-top: 4px;
}

.btn-cancel {
  flex: 1;
  padding: 12px;
  background: var(--border-color, #eee);
  border: none;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}

.btn-submit {
  flex: 2;
  padding: 12px;
  background: var(--primary-color, #4caf50);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-submit:disabled {
  opacity: 0.6;
}

/* 다크모드 */
#app.theme-dark .modal-content,
#app.theme-dark .modal-header {
  background: var(--card-bg);
}
</style>
