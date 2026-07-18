<template>
  <div v-if="show && group" class="modal-overlay" @click.self="$emit('close')">
    <div class="env-config-modal">
      <div class="env-modal-header">
        <h3>구역 환경 설정 — {{ group.name }}</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="env-modal-body">
        <div v-if="envLoading" class="loading-state">불러오는 중...</div>
        <template v-else>
          <div class="env-section-label">내부 환경</div>
          <div v-for="role in envRoles.filter(r => r.category === 'internal')" :key="role.roleKey" class="env-role-row">
            <label class="env-role-label">{{ role.label }} <span v-if="role.unit" class="env-unit">({{ role.unit }})</span></label>
            <select
              class="env-source-select"
              :value="getSelectedValue(role.roleKey)"
              @change="onSourceSelect(role.roleKey, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">(미설정)</option>
              <optgroup label="센서 장치">
                <option
                  v-for="s in envSources.sensors"
                  :key="`sensor:${s.deviceId}:${s.sensorType}`"
                  :value="`sensor:${s.deviceId}:${s.sensorType}`"
                >
                  {{ s.deviceName }} - {{ s.label }} ({{ s.sensorType }}) - {{ s.currentValue != null ? s.currentValue : '-' }}{{ s.unit }}
                </option>
              </optgroup>
              <optgroup label="기상청 날씨">
                <option
                  v-for="w in envSources.weather"
                  :key="`weather:${w.field}`"
                  :value="`weather:${w.field}`"
                >
                  {{ w.label }} ({{ w.field }}) - {{ w.currentValue != null ? w.currentValue : '-' }}{{ w.unit }}
                </option>
              </optgroup>
            </select>
          </div>

          <div class="env-section-label" style="margin-top: 16px;">외부 환경</div>
          <div v-for="role in envRoles.filter(r => r.category === 'external')" :key="role.roleKey" class="env-role-row">
            <label class="env-role-label">{{ role.label }} <span v-if="role.unit" class="env-unit">({{ role.unit }})</span></label>
            <select
              class="env-source-select"
              :value="getSelectedValue(role.roleKey)"
              @change="onSourceSelect(role.roleKey, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">(미설정)</option>
              <optgroup label="센서 장치">
                <option
                  v-for="s in envSources.sensors"
                  :key="`sensor:${s.deviceId}:${s.sensorType}`"
                  :value="`sensor:${s.deviceId}:${s.sensorType}`"
                >
                  {{ s.deviceName }} - {{ s.label }} ({{ s.sensorType }}) - {{ s.currentValue != null ? s.currentValue : '-' }}{{ s.unit }}
                </option>
              </optgroup>
              <optgroup label="기상청 날씨">
                <option
                  v-for="w in envSources.weather"
                  :key="`weather:${w.field}`"
                  :value="`weather:${w.field}`"
                >
                  {{ w.label }} ({{ w.field }}) - {{ w.currentValue != null ? w.currentValue : '-' }}{{ w.unit }}
                </option>
              </optgroup>
            </select>
          </div>

          <!-- 장치 설정 (개폐기/유동팬 동작·대기 + 우적센서) — 폴백/자동제어 공통, 구역 내 전체 게이트웨이 적용 -->
          <template v-if="deviceForm">
            <div class="env-section-label" style="margin-top: 16px;">
              장치 설정
              <span v-if="deviceGateways.length" class="env-unit">· 게이트웨이 {{ deviceGateways.length }}대 공통</span>
            </div>
            <p class="device-hint">개폐기·유동팬 동작/대기 주기와 우적센서. 저장 시 구역 내 모든 게이트웨이에 적용됩니다.</p>
            <div class="device-grid">
              <div class="device-field">
                <label class="env-role-label">개폐기 동작 <span class="env-unit">(초)</span></label>
                <input type="number" min="1" max="600" v-model.number="deviceForm.openerOperationSeconds" class="env-source-select" />
              </div>
              <div class="device-field">
                <label class="env-role-label">개폐기 대기 <span class="env-unit">(초)</span></label>
                <input type="number" min="1" max="600" v-model.number="deviceForm.openerStandbySeconds" class="env-source-select" />
              </div>
              <div class="device-field">
                <label class="env-role-label">유동팬 동작 <span class="env-unit">(분)</span></label>
                <input type="number" min="1" max="240" v-model.number="deviceForm.fanOperationMinutes" class="env-source-select" />
              </div>
              <div class="device-field">
                <label class="env-role-label">유동팬 대기 <span class="env-unit">(분)</span></label>
                <input type="number" min="1" max="240" v-model.number="deviceForm.fanStandbyMinutes" class="env-source-select" />
              </div>
            </div>
            <label v-if="deviceForm.hasRainSensor" class="device-rain-row">
              <input type="checkbox" v-model="deviceForm.rainEnabled" />
              <span>☔ 우적센서 활성화 <span class="env-unit">(비 감지 시 개폐기 자동 닫힘)</span></span>
            </label>
          </template>
        </template>
      </div>
      <div class="env-modal-footer">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <button class="btn-primary" @click="saveEnvConfig" :disabled="envSaving">
          {{ envSaving ? '저장 중...' : '저장' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { envConfigApi } from '../../api/env-config.api'
import type { EnvRole, SourcesResponse, SaveMappingItem, ZoneDeviceSettings } from '../../api/env-config.api'
import type { HouseGroup } from '../../types/group.types'

type DeviceForm = NonNullable<ZoneDeviceSettings['settings']>

const props = defineProps<{
  show: boolean
  group: HouseGroup | null
}>()

const emit = defineEmits<{
  close: []
}>()

const envRoles = ref<EnvRole[]>([])
const envSources = ref<SourcesResponse>({ sensors: [], weather: [] })
const envMappings = ref<Record<string, { sourceType: string; deviceId?: string; sensorType?: string; weatherField?: string }>>({})
const envSaving = ref(false)
const envLoading = ref(false)
const deviceForm = ref<DeviceForm | null>(null)
const deviceGateways = ref<ZoneDeviceSettings['gateways']>([])

watch(() => props.show, async (val) => {
  if (val && props.group) {
    await loadEnvConfig(props.group)
  }
})

async function loadEnvConfig(group: HouseGroup) {
  envLoading.value = true
  try {
    const [rolesRes, sourcesRes, mappingsRes, deviceRes] = await Promise.all([
      envConfigApi.getRoles(),
      envConfigApi.getSources(group.id),
      envConfigApi.getMappings(group.id),
      envConfigApi.getDeviceSettings(group.id),
    ])
    envRoles.value = rolesRes.data
    envSources.value = sourcesRes.data
    deviceGateways.value = deviceRes.data.gateways
    deviceForm.value = deviceRes.data.settings ? { ...deviceRes.data.settings } : null
    const map: Record<string, any> = {}
    for (const m of mappingsRes.data) {
      map[m.roleKey] = {
        sourceType: m.sourceType,
        deviceId: m.deviceId || undefined,
        sensorType: m.sensorType || undefined,
        weatherField: m.weatherField || undefined,
      }
    }
    envMappings.value = map
  } catch (err) {
    console.error('환경설정 로드 실패:', err)
    alert('환경설정을 불러오는데 실패했습니다.')
    emit('close')
  } finally {
    envLoading.value = false
  }
}

async function saveEnvConfig() {
  if (!props.group) return
  envSaving.value = true
  try {
    const mappings: SaveMappingItem[] = Object.entries(envMappings.value)
      .filter(([, v]) => v.sourceType)
      .map(([roleKey, v]) => ({
        roleKey,
        sourceType: v.sourceType as 'sensor' | 'weather',
        deviceId: v.deviceId,
        sensorType: v.sensorType,
        weatherField: v.weatherField,
      }))
    await envConfigApi.saveMappings(props.group.id, mappings)
    // 장치 설정(개폐기/팬 동작·대기 + 우적) — 구역 내 모든 게이트웨이에 fan-out
    if (deviceForm.value) {
      const d = deviceForm.value
      await envConfigApi.saveDeviceSettings(props.group.id, {
        openerOperationSeconds: d.openerOperationSeconds,
        openerStandbySeconds: d.openerStandbySeconds,
        fanOperationMinutes: d.fanOperationMinutes,
        fanStandbyMinutes: d.fanStandbyMinutes,
        ...(d.hasRainSensor ? { rainEnabled: d.rainEnabled } : {}),
      })
    }
    emit('close')
  } catch {
    alert('환경설정 저장에 실패했습니다.')
  } finally {
    envSaving.value = false
  }
}

function onSourceSelect(roleKey: string, value: string) {
  if (!value) {
    delete envMappings.value[roleKey]
    return
  }
  const parts = value.split(':')
  if (parts[0] === 'sensor') {
    envMappings.value[roleKey] = {
      sourceType: 'sensor',
      deviceId: parts[1],
      sensorType: parts[2],
    }
  } else if (parts[0] === 'weather') {
    envMappings.value[roleKey] = {
      sourceType: 'weather',
      weatherField: parts[1],
    }
  }
}

function getSelectedValue(roleKey: string): string {
  const m = envMappings.value[roleKey]
  if (!m) return ''
  if (m.sourceType === 'sensor') return `sensor:${m.deviceId}:${m.sensorType}`
  if (m.sourceType === 'weather') return `weather:${m.weatherField}`
  return ''
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.env-config-modal {
  background: var(--bg-card); border-radius: 16px;
  width: 100%; max-width: 600px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal);
}
.env-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.env-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; }
.env-modal-body {
  flex: 1; overflow-y: auto; padding: 16px 24px;
}
.env-modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 16px 24px; border-top: 1px solid var(--border-color);
}
.env-section-label {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600; color: var(--text-secondary);
  padding: 8px 0 4px; border-bottom: 1px solid var(--border-light);
  margin-bottom: 8px;
}
.env-role-row { margin-bottom: 12px; }
.env-role-label {
  display: block; font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500; color: var(--text-primary); margin-bottom: 4px;
}
.env-unit { color: var(--text-muted); font-weight: 400; }
.env-source-select {
  width: 100%; padding: 10px 12px;
  background: var(--bg-secondary); color: var(--text-primary);
  border: 1px solid var(--border-input); border-radius: 8px;
  font-size: calc(14px * var(--content-scale, 1)); cursor: pointer;
}
.env-source-select:focus { outline: none; border-color: var(--accent); }
.device-hint {
  font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted);
  margin: 0 0 10px;
}
.device-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px;
}
.device-field { min-width: 0; }
.device-rain-row {
  display: flex; align-items: center; gap: 10px; margin-top: 12px;
  padding: 10px 12px; background: var(--bg-secondary); border-radius: 8px;
  cursor: pointer;
}
.device-rain-row input { width: 18px; height: 18px; flex-shrink: 0; }
.loading-state { text-align: center; padding: 40px 20px; color: var(--text-secondary); }
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
}
.btn-primary {
  padding: 14px 28px; background: var(--accent); color: white; border: none;
  border-radius: 8px; font-weight: 600; font-size: calc(16px * var(--content-scale, 1)); cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 10px 20px; background: var(--bg-hover); color: var(--text-primary);
  border: none; border-radius: 8px; font-weight: 500; cursor: pointer;
}

@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .env-config-modal {
    border-radius: 0; max-width: 100%; max-height: 100%;
    height: 100vh; height: 100dvh; overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .env-modal-header { padding-top: calc(16px + env(safe-area-inset-top, 0px)); }
}
</style>
