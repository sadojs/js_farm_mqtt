<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { deviceApi } from '@/api/device.api'
import { gatewayApi } from '@/api/gateway.api'
import { gatewayEnvApi, type ZigbeeScannedDevice } from '@/api/gateway-env.api'
import { useNotification } from '@/composables/useNotification'

interface Props {
  visible: boolean
  deviceId: string | null
  gatewayUuid: string  // hk-house gateway의 UUID
}

const props = defineProps<Props>()
const emit = defineEmits<{ close: []; replaced: [{ deviceId: string; oldIeee: string; newIeee: string }] }>()

const notif = useNotification()

const loading = ref(false)
const preview = ref<Awaited<ReturnType<typeof deviceApi.replacePreview>>['data'] | null>(null)
const candidates = ref<ZigbeeScannedDevice[]>([])
const selectedCandidate = ref<ZigbeeScannedDevice | null>(null)

const scanning = ref(false)
const permitJoining = ref(false)
const permitJoinSecondsLeft = ref(0)
let permitJoinInterval: ReturnType<typeof setInterval> | null = null
let permitJoinRescanInterval: ReturnType<typeof setInterval> | null = null

const forceStopTimeline = ref(false)
const replacing = ref(false)

// 페어 개폐기인 경우 페어 후보 선택용
const selectedPairedCandidate = ref<ZigbeeScannedDevice | null>(null)

const isPair = computed(() => !!preview.value?.impact.pairedDeviceId)
const isController = computed(() => preview.value?.device.equipmentType === 'controller')
const requiresPairSelection = computed(() => isPair.value)
const requiresForceConfirm = computed(() => preview.value?.impact.hasRunningTimeline)

async function loadPreview() {
  if (!props.deviceId) return
  loading.value = true
  try {
    const res = await deviceApi.replacePreview(props.deviceId)
    preview.value = res.data
  } catch (e: any) {
    notif.error('미리보기 실패', e?.response?.data?.message ?? '교체 정보를 불러올 수 없습니다.')
    emit('close')
  } finally {
    loading.value = false
  }
}

async function startScan() {
  scanning.value = true
  candidates.value = []
  selectedCandidate.value = null
  selectedPairedCandidate.value = null
  try {
    // 1. permit_join 켜기 (스캔 대기 60초)
    await gatewayApi.permitJoin(props.gatewayUuid, true)
    permitJoining.value = true
    permitJoinSecondsLeft.value = 60

    // 카운트다운 + 주기적 재스캔으로 새 device 감지
    permitJoinInterval = setInterval(() => {
      permitJoinSecondsLeft.value -= 1
      if (permitJoinSecondsLeft.value <= 0) stopPermitJoin()
    }, 1000)
    permitJoinRescanInterval = setInterval(() => { runScan() }, 5000)

    await runScan()
  } catch (e: any) {
    notif.error('스캔 시작 실패', e?.response?.data?.message ?? '페어링 모드를 시작할 수 없습니다.')
    stopPermitJoin()
  }
}

async function runScan() {
  if (!preview.value) return
  try {
    const res = await gatewayEnvApi.scanZigbee(props.gatewayUuid)
    const all = Array.isArray(res.data) ? res.data : []
    // 옛 device의 IEEE는 후보에서 제외 — 같은 device를 자기 자신과 swap하는 케이스
    const oldIeee = preview.value.device.zigbeeIeee?.toLowerCase()
    candidates.value = all.filter(d => {
      if (d.ieee_address?.toLowerCase() === oldIeee) return false
      return isCompatible(d)
    })
  } catch { /* ignore mid-scan errors */ } finally { scanning.value = false }
}

function isCompatible(c: ZigbeeScannedDevice): boolean {
  if (!preview.value) return false
  const { requireModel, requireChannelCount } = preview.value.compatibility
  // model 엄격 일치 (case-insensitive)
  if (requireModel && c.model_id && requireModel.toLowerCase() !== c.model_id.toLowerCase()) return false
  // controller 채널 수 일치
  if (requireChannelCount && c.detectedChannelCount && c.detectedChannelCount !== requireChannelCount) return false
  return true
}

function stopPermitJoin() {
  if (permitJoinInterval) { clearInterval(permitJoinInterval); permitJoinInterval = null }
  if (permitJoinRescanInterval) { clearInterval(permitJoinRescanInterval); permitJoinRescanInterval = null }
  if (permitJoining.value) {
    gatewayApi.permitJoin(props.gatewayUuid, false).catch(() => undefined)
  }
  permitJoining.value = false
  scanning.value = false
}

async function executeReplace() {
  if (!preview.value || !props.deviceId || !selectedCandidate.value) return
  if (requiresPairSelection.value && !selectedPairedCandidate.value) {
    notif.error('페어 선택 필요', '페어 개폐기는 양쪽 모두 새 장치를 선택해야 합니다.')
    return
  }
  if (requiresForceConfirm.value && !forceStopTimeline.value) {
    notif.error('확인 필요', '진행 중 관수 timeline 중단 옵션을 체크해 주세요.')
    return
  }
  replacing.value = true
  try {
    const res = await deviceApi.replace(props.deviceId, {
      newIeee: selectedCandidate.value.ieee_address,
      newFriendlyName: selectedCandidate.value.friendly_name,
      newZigbeeModel: selectedCandidate.value.model_id,
      pairedNewIeee: selectedPairedCandidate.value?.ieee_address,
      pairedNewFriendlyName: selectedPairedCandidate.value?.friendly_name,
      forceStopRunningTimeline: forceStopTimeline.value,
    })
    notif.success(
      '교체 완료',
      `${preview.value.device.name} — 자동제어룰 ${res.data.preserved.rules}개, 채널 매핑 ${res.data.preserved.mappingKeys}개 보존`,
    )
    emit('replaced', { deviceId: res.data.deviceId, oldIeee: res.data.oldIeee, newIeee: res.data.newIeee })
    handleClose()
  } catch (e: any) {
    const err = e?.response?.data
    if (err?.error === 'running_timeline') {
      notif.error('진행 중 관수', `${err.deviceName ?? ''}이 동작 중입니다. "관수 중단 후 교체" 체크 후 다시 시도해 주세요.`)
    } else if (err?.error === 'duplicate_ieee') {
      notif.error('중복 IEEE', `선택한 장치는 이미 다른 device로 등록되어 있습니다.`)
    } else if (err?.error === 'incompatible') {
      notif.error('호환성 미달', err.detail ?? '모델이 일치하지 않습니다.')
    } else if (err?.error === 'pair_required') {
      notif.error('페어 필수', '페어 개폐기는 양쪽 모두 선택 후 교체 필요')
    } else {
      notif.error('교체 실패', err?.message ?? '교체 실행에 실패했습니다.')
    }
  } finally {
    replacing.value = false
  }
}

function handleClose() {
  stopPermitJoin()
  selectedCandidate.value = null
  selectedPairedCandidate.value = null
  candidates.value = []
  forceStopTimeline.value = false
  emit('close')
}

watch(() => props.visible, (v) => {
  if (v) loadPreview()
  else stopPermitJoin()
})

onBeforeUnmount(stopPermitJoin)
onMounted(() => { if (props.visible) loadPreview() })
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="handleClose">
    <div class="modal replace-modal">
      <div class="modal-header">
        <h3>🔄 장치 교체 — {{ preview?.device.name ?? '...' }}</h3>
        <button class="modal-close" @click="handleClose">✕</button>
      </div>

      <div v-if="loading" class="loading">미리보기 불러오는 중...</div>

      <div v-else-if="preview" class="modal-body">
        <!-- 영향 분석 (보존될 자원) -->
        <div class="impact-panel">
          <div class="impact-title">📋 교체 후 자동 보존됩니다</div>
          <div class="impact-grid">
            <div class="impact-item">
              <span class="impact-label">자동제어룰</span>
              <span class="impact-value">{{ preview.impact.rulesCount }}개</span>
              <div v-if="preview.impact.ruleNames.length" class="impact-detail">
                {{ preview.impact.ruleNames.slice(0, 3).join(', ') }}{{ preview.impact.ruleNames.length > 3 ? ' 외' : '' }}
              </div>
            </div>
            <div class="impact-item">
              <span class="impact-label">채널 매핑</span>
              <span class="impact-value">{{ preview.impact.mappingKeys }}개</span>
            </div>
            <div v-if="preview.impact.pairedDeviceId" class="impact-item">
              <span class="impact-label">페어링</span>
              <span class="impact-value">{{ preview.impact.pairedDeviceName }}</span>
            </div>
            <div v-if="isController" class="impact-item">
              <span class="impact-label">컨트롤러 채널</span>
              <span class="impact-value">{{ preview.impact.childrenCount }}개 (children)</span>
            </div>
          </div>
        </div>

        <!-- 호환 조건 -->
        <div class="compat-panel">
          <div class="compat-title">⚙ 호환 조건 (모두 일치해야 후보로 등장)</div>
          <ul class="compat-list">
            <li>모델: <strong>{{ preview.compatibility.requireModel ?? '제한 없음' }}</strong></li>
            <li>유형: <strong>{{ preview.compatibility.requireEquipmentType }}</strong></li>
            <li v-if="preview.compatibility.requireChannelCount">채널 수: <strong>{{ preview.compatibility.requireChannelCount }}채널</strong></li>
            <li v-if="preview.compatibility.requirePair">페어 개폐기: <strong>양쪽 동시 교체 필요</strong></li>
          </ul>
        </div>

        <!-- 진행 중 timeline 경고 -->
        <div v-if="requiresForceConfirm" class="warning-panel">
          <div class="warning-icon">⚠️</div>
          <div>
            <strong>진행 중인 관수가 있습니다.</strong>
            <label class="checkbox-row">
              <input type="checkbox" v-model="forceStopTimeline" />
              관수를 안전 중단하고 교체 진행
            </label>
          </div>
        </div>

        <!-- 현재 상태 -->
        <div class="current-state">
          <div>현재 IEEE: <code>{{ preview.device.zigbeeIeee }}</code></div>
          <div>이름: <code>{{ preview.device.friendlyName }}</code></div>
        </div>

        <!-- 스캔 영역 -->
        <div class="scan-section">
          <div v-if="!permitJoining && candidates.length === 0" class="scan-cta">
            <p>새 장치를 페어링 모드로 두고 아래 버튼을 누르세요.</p>
            <button class="btn-primary" :disabled="scanning" @click="startScan">📡 페어링 모드 시작 (60초)</button>
          </div>

          <div v-else-if="permitJoining" class="pairing-banner">
            <strong>📡 새 장치 수신 대기 중 — {{ permitJoinSecondsLeft }}초</strong>
            <p>새 zigbee 장치의 페어링 버튼을 길게 누르세요. 자동으로 아래 후보에 등장합니다.</p>
            <button class="btn-secondary btn-sm" @click="stopPermitJoin">중지</button>
          </div>

          <div v-if="candidates.length > 0" class="candidate-list">
            <div class="candidate-title">호환 후보 ({{ candidates.length }}개)</div>
            <label v-for="c in candidates" :key="c.ieee_address" class="candidate-row">
              <input type="radio" name="candidate" :value="c.ieee_address"
                :checked="selectedCandidate?.ieee_address === c.ieee_address"
                @change="selectedCandidate = c" />
              <div>
                <div class="cand-ieee">{{ c.ieee_address }}</div>
                <div class="cand-meta">{{ c.model_id }} · {{ c.definition?.description ?? '' }}</div>
              </div>
            </label>
            <!-- 페어 개폐기 — 두 번째 candidate 선택 -->
            <template v-if="requiresPairSelection && selectedCandidate">
              <div class="candidate-title" style="margin-top: 12px;">페어 ({{ preview.impact.pairedDeviceName }})의 새 장치</div>
              <label v-for="c in candidates.filter(c => c.ieee_address !== selectedCandidate?.ieee_address)"
                :key="c.ieee_address" class="candidate-row">
                <input type="radio" name="pairedCandidate" :value="c.ieee_address"
                  :checked="selectedPairedCandidate?.ieee_address === c.ieee_address"
                  @change="selectedPairedCandidate = c" />
                <div>
                  <div class="cand-ieee">{{ c.ieee_address }}</div>
                  <div class="cand-meta">{{ c.model_id }}</div>
                </div>
              </label>
            </template>
          </div>
        </div>
      </div>

      <div v-if="preview" class="modal-actions">
        <button class="btn-secondary" @click="handleClose" :disabled="replacing">취소</button>
        <button class="btn-primary"
          :disabled="!selectedCandidate || replacing || (requiresPairSelection && !selectedPairedCandidate)"
          @click="executeReplace">
          {{ replacing ? '교체 중...' : '🔄 교체 실행' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.replace-modal {
  background: var(--bg-card, #fff); border-radius: 12px;
  width: 90%; max-width: 600px; max-height: 90vh;
  display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.modal-header h3 { margin: 0; font-size: 16px; }
.modal-close {
  background: none; border: none; font-size: 20px; cursor: pointer;
  color: var(--text-secondary);
}
.loading { padding: 40px; text-align: center; color: var(--text-secondary); }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px; }

.impact-panel, .compat-panel, .warning-panel, .current-state, .scan-section {
  padding: 12px; border-radius: 8px; border: 1px solid var(--border-color, #e5e7eb);
}
.impact-panel { background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.3); }
.impact-title { font-size: 13px; font-weight: 700; color: #15803d; margin-bottom: 8px; }
.impact-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.impact-item { display: flex; flex-direction: column; min-width: 120px; }
.impact-label { font-size: 11px; color: var(--text-secondary); }
.impact-value { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.impact-detail { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

.compat-panel { background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.3); }
.compat-title { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 6px; }
.compat-list { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-primary); }
.compat-list li { margin: 2px 0; }

.warning-panel {
  display: flex; gap: 10px; background: #fef3c7; border-color: #fbbf24;
}
.warning-icon { font-size: 24px; }
.checkbox-row { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 6px; cursor: pointer; }

.current-state {
  font-size: 12px; color: var(--text-secondary);
  display: flex; flex-direction: column; gap: 3px;
}
.current-state code { background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px; }

.scan-section { background: var(--bg-secondary, #f9fafb); }
.scan-cta { text-align: center; padding: 8px; }
.scan-cta p { margin: 0 0 10px; font-size: 13px; color: var(--text-secondary); }

.pairing-banner {
  display: flex; flex-direction: column; gap: 6px; padding: 4px;
}
.pairing-banner strong { color: #1e40af; font-size: 13px; }
.pairing-banner p { margin: 0; font-size: 12px; color: var(--text-secondary); }

.candidate-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.candidate-title { font-size: 12px; font-weight: 700; color: var(--text-primary); }
.candidate-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  cursor: pointer;
}
.candidate-row:hover { background: rgba(59,130,246,.05); }
.cand-ieee { font-size: 13px; font-family: monospace; }
.cand-meta { font-size: 11px; color: var(--text-secondary); }

.modal-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 20px; border-top: 1px solid var(--border-color);
}
.btn-primary {
  background: #3b82f6; color: #fff; border: none;
  padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
.btn-primary:hover:not(:disabled) { background: #2563eb; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary {
  background: var(--bg-card); border: 1px solid var(--border-color);
  padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
  color: var(--text-secondary);
}
.btn-sm { font-size: 12px; padding: 4px 10px; }
</style>
