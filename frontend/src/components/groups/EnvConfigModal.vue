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
          <div class="env-section-label">구역 정보</div>
          <div class="group-info-fields">
            <input v-model="groupName" class="env-source-select" maxlength="50" placeholder="구역명" />
            <input v-model="groupDesc" class="env-source-select" maxlength="100" placeholder="설명 (선택)" />
          </div>

          <div class="env-section-label" style="margin-top: 16px;">내부 환경</div>
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
            <label class="device-rain-row">
              <input type="checkbox" v-model="deviceForm.highTempOverrideEnabled" />
              <span>🔥 고온 무대기 강제열림 <span class="env-unit">(비 그친 뒤 고온 시 개폐기 대기 없이 연속 개방)</span></span>
            </label>
            <div v-if="deviceForm.highTempOverrideEnabled" class="device-field" style="margin-top: 8px;">
              <label class="env-role-label">고온 임계 온도 <span class="env-unit">(°C 이상 시 강제열림)</span></label>
              <input type="number" min="-10" max="100" step="0.5" v-model.number="deviceForm.highTempOpenThreshold" class="env-source-select" placeholder="예: 35" />
            </div>
          </template>

          <!-- 환경 경보 — 숫자가 오래 넘으면 알림 (순간적인 튀는 값은 무시) -->
          <template v-if="alertForm">
            <div class="env-section-label" style="margin-top: 16px;">
              환경 경보
              <span class="env-unit">· {{ alertForm.saved ? '사용 중' : '아직 저장 전 — 저장하면 감시를 시작합니다' }}</span>
            </div>
            <p class="device-hint">순간적으로 튀는 값은 무시하고, 지속 시간을 넘길 때만 한 번 알립니다. 정상으로 돌아오면 한 번 더 알립니다.</p>
            <div v-for="item in alertForm.items" :key="item.key" class="alert-row" :class="{ off: !item.enabled }">
              <label class="alert-toggle">
                <input type="checkbox" v-model="item.enabled" @change="alertTouched = true" />
                <span class="alert-pill" :class="{ on: item.enabled }">{{ item.enabled ? '켜짐' : '꺼짐' }}</span>
              </label>
              <span class="alert-text">
                {{ item.label }}가
                <input type="number" class="alert-num" step="0.5" v-model.number="item.threshold" :aria-label="`${item.label} 기준`" @input="alertTouched = true" />{{ item.unit }}
                {{ item.dir === 'low' ? '이하' : '이상' }}인 상태가
                <input type="number" class="alert-num" min="1" max="180" v-model.number="item.minutes" aria-label="지속 시간(분)" @input="alertTouched = true" />분
                이어지면 알림
              </span>
            </div>
            <div class="alert-channel">
              <label class="env-role-label" for="alert-channel">알림 받는 곳</label>
              <select id="alert-channel" v-model="alertForm.channel" class="env-source-select" @change="alertTouched = true">
                <option value="push">앱 푸시 + 알림 센터</option>
                <option value="center">알림 센터만</option>
              </select>
            </div>
            <p v-if="!hasInternalTemp" class="device-hint" style="margin-top: 8px;">
              내부 온도·습도 경보는 위 "내부 환경"에서 센서를 지정해야 동작합니다. 토양 수분은 이 구역 센서의 평균값을 씁니다.
            </p>
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
import { notify } from '../../utils/dialogs'
import { ref, watch, computed } from 'vue'
import { envConfigApi } from '../../api/env-config.api'
import { groupApi } from '../../api/group.api'
import { useGroupStore } from '../../stores/group.store'
import type { EnvRole, SourcesResponse, SaveMappingItem, ZoneDeviceSettings, EnvAlertSettings } from '../../api/env-config.api'
import { envAlertsApi } from '../../api/env-config.api'
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
// 구역 이름/설명 (구역관리 메인페이지에서 이동해 온 편집 항목)
const groupName = ref('')
const groupDesc = ref('')
const groupStore = useGroupStore()
// 환경 경보 — 저장 전 구역은 손대지 않으면 저장하지 않는다(의도치 않게 감시 시작 방지)
const alertForm = ref<EnvAlertSettings | null>(null)
const alertTouched = ref(false)
const hasInternalTemp = computed(() => !!envMappings.value['internal_temp'] || !!envMappings.value['internal_humidity'])

watch(() => props.show, async (val) => {
  if (val && props.group) {
    await loadEnvConfig(props.group)
  }
})

async function loadEnvConfig(group: HouseGroup) {
  envLoading.value = true
  groupName.value = group.name
  groupDesc.value = group.description ?? ''
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
    alertTouched.value = false
    alertForm.value = await envAlertsApi.get(group.id).then(r => r.data).catch(() => null)
  } catch (err) {
    console.error('환경설정 로드 실패:', err)
    notify('환경설정을 불러오는데 실패했습니다.')
    emit('close')
  } finally {
    envLoading.value = false
  }
}

async function saveEnvConfig() {
  if (!props.group) return
  // 경보 지속 시간은 저장 전에 먼저 확인 (다른 항목만 저장되고 멈추지 않도록)
  if (alertForm.value?.items.some(i => !(i.minutes >= 1 && i.minutes <= 180))) {
    notify('경보 지속 시간은 1~180분 사이로 입력해 주세요.', 'warning')
    return
  }
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
    // 구역 이름/설명 저장 (변경 시)
    const nm = groupName.value.trim()
    if (nm && (nm !== props.group.name || groupDesc.value.trim() !== (props.group.description ?? ''))) {
      await groupApi.updateGroup(props.group.id, { name: nm, description: groupDesc.value.trim() || undefined })
      await groupStore.fetchGroups().catch(() => undefined)
    }
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
        highTempOverrideEnabled: d.highTempOverrideEnabled,
        highTempOpenThreshold: d.highTempOpenThreshold ?? null,
      })
    }
    // 환경 경보 — 이미 쓰는 중이거나 이번에 손댄 경우에만 저장
    if (alertForm.value && (alertForm.value.saved || alertTouched.value)) {
      await envAlertsApi.save(props.group.id, {
        items: alertForm.value.items.map(({ key, enabled, threshold, minutes }) => ({ key, enabled, threshold, minutes })),
        channel: alertForm.value.channel,
      })
    }
    emit('close')
  } catch (e: any) {
    const msg = e?.response?.data?.message
    if (msg && typeof msg === 'string') { notify(msg, 'error'); return }
    notify('환경설정 저장에 실패했습니다.')
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
.group-info-fields { display: flex; flex-direction: column; gap: 8px; }
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
  font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500; color: var(--text-primary);
}
.device-rain-row input { width: 18px; height: 18px; flex-shrink: 0; }
.loading-state { text-align: center; padding: 40px 20px; color: var(--text-secondary); }
.alert-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 8px;
  background: var(--bg-secondary); border-radius: 8px;
  font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary);
}
.alert-row.off .alert-text { color: var(--text-muted); }
.alert-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.alert-toggle input { width: 18px; height: 18px; }
.alert-pill {
  padding: 2px 8px; border-radius: 999px; font-size: calc(12px * var(--content-scale, 1)); font-weight: 700;
  background: var(--bg-hover); color: var(--text-muted);
}
.alert-pill.on { background: var(--accent-bg); color: var(--accent); }
.alert-text { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.9; }
.alert-num {
  width: 64px; padding: 4px 6px; text-align: center;
  background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border-input); border-radius: 6px;
  font-size: calc(14px * var(--content-scale, 1));
}
.alert-channel { margin-top: 4px; }
.close-btn {
  background: none; border: none; font-size: calc(20px * var(--content-scale, 1)); color: var(--text-muted);
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
