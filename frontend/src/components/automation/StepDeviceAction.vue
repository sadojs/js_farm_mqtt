<template>
  <div class="step-device">
    <h3 class="step-title">장비 및 동작 설정</h3>
    <p class="step-desc">제어할 장비 유형과 동작을 선택하세요</p>

    <!-- 장비 유형 선택 -->
    <div class="device-selector">
      <button type="button" v-for="dt in deviceTypes" :key="dt.value" class="device-card" :class="{ active: selectedDevice === dt.value }" @click="selectDevice(dt.value)">
        <span class="device-icon">{{ dt.icon }}</span>
        <span class="device-label">{{ dt.label }}</span>
      </button>
    </div>

    <!-- 개폐기 설정 -->
    <div v-if="selectedDevice === 'roof_actuator'" class="action-form">
      <div class="form-group">
        <label class="field-label">동작</label>
        <div class="btn-group">
          <button type="button" class="btn-option" :class="{ active: roofCommand === 'open' }" @click="roofCommand = 'open'; emitAction()">열기</button>
          <button type="button" class="btn-option" :class="{ active: roofCommand === 'close' }" @click="roofCommand = 'close'; emitAction()">닫기</button>
        </div>
      </div>
      <div class="form-group">
        <label class="field-label">개방 비율: {{ roofPercentage }}%</label>
        <input type="range" class="range-input" v-model.number="roofPercentage" min="0" max="100" step="10" @input="emitAction()" />
        <div class="range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
      </div>
    </div>

    <!-- 환풍기 설정 -->
    <div v-if="selectedDevice === 'ventilation_fan'" class="action-form">
      <div class="form-group">
        <label class="field-label">동작</label>
        <div class="btn-group">
          <button type="button" class="btn-option" :class="{ active: fanCommand === 'on' }" @click="fanCommand = 'on'; emitAction()">ON</button>
          <button type="button" class="btn-option" :class="{ active: fanCommand === 'off' }" @click="fanCommand = 'off'; emitAction()">OFF</button>
        </div>
      </div>
      <div v-if="fanCommand === 'on'" class="form-group">
        <label class="field-label">속도</label>
        <div class="btn-group">
          <button type="button" class="btn-option" :class="{ active: fanSpeed === 'low' }" @click="fanSpeed = 'low'; emitAction()">저속</button>
          <button type="button" class="btn-option" :class="{ active: fanSpeed === 'mid' }" @click="fanSpeed = 'mid'; emitAction()">중속</button>
          <button type="button" class="btn-option" :class="{ active: fanSpeed === 'high' }" @click="fanSpeed = 'high'; emitAction()">고속</button>
        </div>
      </div>
    </div>

    <!-- 관수 설정 -->
    <div v-if="selectedDevice === 'irrigation'" class="action-form">
      <div class="form-group">
        <label class="field-label">관수 모드</label>
        <div class="btn-group">
          <button type="button" class="btn-option" :class="{ active: irrigMode === 'water_only' }" @click="irrigMode = 'water_only'; emitAction()">물만</button>
          <button type="button" class="btn-option" :class="{ active: irrigMode === 'fertilizer_only' }" @click="irrigMode = 'fertilizer_only'; emitAction()">비료만</button>
          <button type="button" class="btn-option" :class="{ active: irrigMode === 'sequence' }" @click="irrigMode = 'sequence'; emitAction()">순차 실행</button>
        </div>
      </div>

      <!-- 단일 관수 (물만 / 비료만) -->
      <div v-if="irrigMode !== 'sequence'" class="form-group">
        <label class="field-label">단위</label>
        <div class="btn-group">
          <button type="button" class="btn-option" :class="{ active: irrigUnit === 'minutes' }" @click="irrigUnit = 'minutes'; emitAction()">시간(분)</button>
          <button type="button" class="btn-option" :class="{ active: irrigUnit === 'liters' }" @click="irrigUnit = 'liters'; emitAction()">용량(L)</button>
        </div>
      </div>
      <div v-if="irrigMode !== 'sequence'" class="form-group">
        <label class="field-label">{{ irrigUnit === 'minutes' ? '시간 (분)' : '용량 (리터)' }}</label>
        <input type="number" class="form-input" v-model.number="irrigValue" min="1" @input="emitAction()" />
      </div>

      <!-- 순차 실행 -->
      <IrrigationSequenceBuilder v-if="irrigMode === 'sequence'" v-model="irrigSequence" @update:modelValue="emitAction()" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DeviceType, RuleAction, IrrigationStep } from '../../types/automation.types'
import { createEmptyIrrigationStep } from '../../utils/automation-helpers'
import IrrigationSequenceBuilder from './IrrigationSequenceBuilder.vue'

interface ActionValue {
  deviceType: DeviceType | null
  action: RuleAction | null
}

const props = defineProps<{ modelValue: ActionValue }>()
const emit = defineEmits<{ 'update:modelValue': [val: ActionValue] }>()

const deviceTypes = [
  { value: 'roof_actuator' as DeviceType, icon: '🏠', label: '개폐기' },
  { value: 'ventilation_fan' as DeviceType, icon: '💨', label: '환풍기' },
  { value: 'irrigation' as DeviceType, icon: '💧', label: '관수' },
]

const selectedDevice = ref<DeviceType | null>(props.modelValue.deviceType)

// 개폐기 상태
const roofCommand = ref('open')
const roofPercentage = ref(100)

// 환풍기 상태
const fanCommand = ref('on')
const fanSpeed = ref<'low' | 'mid' | 'high'>('mid')

// 관수 상태
const irrigMode = ref<'water_only' | 'fertilizer_only' | 'sequence'>('water_only')
const irrigUnit = ref<'minutes' | 'liters'>('minutes')
const irrigValue = ref(10)
const irrigSequence = ref<IrrigationStep[]>([
  createEmptyIrrigationStep(),
])

// 수정 모드에서 기존 값 로드
watch(() => props.modelValue, (val) => {
  if (val.deviceType && val.action) {
    selectedDevice.value = val.deviceType
    const a = val.action
    if (a.deviceType === 'roof_actuator') {
      roofCommand.value = a.command ?? 'open'
      roofPercentage.value = (a.parameters as any).percentage ?? 100
    } else if (a.deviceType === 'ventilation_fan') {
      fanCommand.value = a.command ?? 'on'
      fanSpeed.value = (a.parameters as any).speed ?? 'mid'
    } else if (a.deviceType === 'irrigation') {
      const p = a.parameters as any
      irrigMode.value = p.mode ?? 'water_only'
      irrigUnit.value = p.durationUnit ?? 'minutes'
      irrigValue.value = p.duration ?? p.volume ?? 10
      if (p.sequence) irrigSequence.value = p.sequence
    }
  }
}, { immediate: true })

function selectDevice(dt: DeviceType) {
  selectedDevice.value = dt
  emitAction()
}

function emitAction() {
  if (!selectedDevice.value) return

  let action: RuleAction

  if (selectedDevice.value === 'roof_actuator') {
    action = {
      deviceType: 'roof_actuator',
      command: roofCommand.value,
      parameters: { percentage: roofPercentage.value },
    }
  } else if (selectedDevice.value === 'ventilation_fan') {
    action = {
      deviceType: 'ventilation_fan',
      command: fanCommand.value,
      parameters: { speed: fanCommand.value === 'on' ? fanSpeed.value : undefined },
    }
  } else {
    if (irrigMode.value === 'sequence') {
      action = {
        deviceType: 'irrigation',
        command: 'sequence',
        parameters: { mode: 'sequence', sequence: irrigSequence.value },
      }
    } else {
      action = {
        deviceType: 'irrigation',
        command: 'single',
        parameters: {
          mode: irrigMode.value,
          ...(irrigUnit.value === 'minutes' ? { duration: irrigValue.value } : { volume: irrigValue.value }),
          durationUnit: irrigUnit.value,
        },
      }
    }
  }

  emit('update:modelValue', { deviceType: selectedDevice.value, action })
}
</script>

<style scoped>
.step-title { font-size: 20px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.step-desc { color: #888; font-size: 14px; margin-bottom: 20px; }

.device-selector { display: flex; gap: 12px; margin-bottom: 24px; }
.device-card {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 16px; border: 2px solid var(--border-input); border-radius: 12px; cursor: pointer;
  background: var(--bg-card); transition: all 0.2s;
}
.device-card:hover { border-color: #4caf50; }
.device-card.active { border-color: #4caf50; background: #f1f8e9; }
.device-icon { font-size: 32px; }
.device-label { font-weight: 600; font-size: 15px; color: var(--text-primary); }

.action-form { background: #fafafa; border-radius: 12px; padding: 20px; }
.form-group { margin-bottom: 16px; }
.form-group:last-child { margin-bottom: 0; }
.field-label { display: block; font-weight: 600; font-size: 14px; color: var(--text-secondary); margin-bottom: 8px; }

.btn-group { display: flex; gap: 8px; }
.btn-option {
  padding: 8px 16px; border: 2px solid var(--border-input); border-radius: 8px; background: var(--bg-card);
  cursor: pointer; font-weight: 500; font-size: 14px; color: var(--text-link); transition: all 0.2s;
}
.btn-option:hover { border-color: #4caf50; }
.btn-option.active { border-color: #4caf50; background: #4caf50; color: white; }

.range-input { width: 100%; margin: 8px 0; accent-color: #4caf50; }
.range-labels { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }

.form-input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  font-size: 14px; color: var(--text-primary);
}
</style>
