<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>설정 배포</h2>
        <p class="page-description">라즈베리파이 게이트웨이에 Zigbee2MQTT 설정을 원격 배포합니다</p>
      </div>
    </header>

    <!-- Step 1: 공통 설정 편집 -->
    <section class="deploy-section">
      <h3>1. 공통 설정 편집</h3>
      <p class="section-hint">배포 대상: Zigbee2MQTT configuration.yaml의 공통 설정 영역. 보호 필드(게이트웨이 ID, network_key 등)는 변경되지 않습니다.</p>

      <div class="config-editor-wrap">
        <div class="config-form">
          <div class="form-group">
            <label>log_level</label>
            <select v-model="config.advanced!.log_level">
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
          <div class="form-group">
            <label>channel (Zigbee)</label>
            <select v-model.number="config.advanced!.channel">
              <option :value="11">11 (기본)</option>
              <option :value="15">15</option>
              <option :value="20">20</option>
              <option :value="25">25</option>
            </select>
          </div>
          <div class="form-group">
            <label>frontend.port</label>
            <input type="number" v-model.number="config.frontend!.port" min="1024" max="65535" />
          </div>
          <div class="form-group">
            <label>availability.active.timeout (분)</label>
            <input type="number" v-model.number="config.availability!.active!.timeout" min="1" max="60" />
          </div>
          <div class="form-group">
            <label>availability.passive.timeout (분)</label>
            <input type="number" v-model.number="config.availability!.passive!.timeout" min="60" max="3000" />
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="config.ota!.disable_automatic_update_check" />
              OTA 자동 업데이트 비활성화
            </label>
          </div>
        </div>

        <!-- 배포될 YAML 미리보기 -->
        <div class="yaml-preview">
          <div class="yaml-preview-header">
            <span class="yaml-preview-title">배포될 설정 (configuration.yaml)</span>
            <button class="btn-text" @click="yamlExpanded = !yamlExpanded">
              {{ yamlExpanded ? '접기' : '펼치기' }}
            </button>
          </div>
          <pre v-if="yamlExpanded" class="yaml-code"><code>{{ configYaml }}</code></pre>
          <div v-else class="yaml-collapsed">
            <code>{{ configYamlSummary }}</code>
          </div>
          <div class="yaml-protected-notice">
            <strong>아래 필드는 각 게이트웨이의 기존 값이 유지됩니다:</strong>
            <code>mqtt.base_topic, mqtt.server, advanced.network_key, advanced.pan_id, serial, devices, groups</code>
          </div>
        </div>
      </div>
    </section>

    <!-- Step 2: 배포 대상 선택 -->
    <section class="deploy-section">
      <h3>2. 배포 대상 선택</h3>
      <div v-if="gatewaysLoading" class="loading-state">게이트웨이 목록 로딩 중...</div>
      <div v-else-if="gateways.length === 0" class="empty-state">
        <p>등록된 게이트웨이가 없습니다.</p>
      </div>
      <div v-else class="gateway-selector">
        <label class="gateway-checkbox select-all">
          <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          <span>전체 선택 ({{ selectedGateways.length }}/{{ gateways.length }})</span>
        </label>
        <label v-for="gw in gateways" :key="gw.id" class="gateway-checkbox">
          <input type="checkbox" :value="gw.gatewayId" v-model="selectedGateways" />
          <span class="gw-info">
            <strong>{{ gw.gatewayId }}</strong> - {{ gw.name }}
            <span :class="['status-badge', gw.status]">{{ gw.status }}</span>
          </span>
        </label>
      </div>
    </section>

    <!-- 액션 버튼 -->
    <div class="deploy-actions">
      <button
        class="btn-secondary"
        :disabled="selectedGateways.length === 0 || previewing"
        @click="runPreview"
      >
        {{ previewing ? '미리보기 중...' : '미리보기' }}
      </button>
      <button
        class="btn-primary"
        :disabled="selectedGateways.length === 0 || deploying"
        @click="confirmDeploy"
      >
        {{ deploying ? '배포 중...' : `배포 실행 (${selectedGateways.length}개)` }}
      </button>
    </div>

    <!-- Step 3: 미리보기 결과 -->
    <section v-if="previewResults.length > 0" class="deploy-section">
      <h3>3. 미리보기 결과</h3>
      <div v-for="result in previewResults" :key="result.gatewayId" class="preview-card">
        <div class="preview-header">
          <strong>{{ result.gatewayId }}</strong> - {{ result.gatewayName }}
          <span :class="['status-badge', result.status]">{{ statusLabel(result.status) }}</span>
        </div>
        <div v-if="result.diff && result.diff.length > 0" class="diff-list">
          <div v-for="d in result.diff" :key="d.field" :class="['diff-item', { protected: d.protected }]">
            <span class="diff-field">{{ d.field }}</span>
            <span v-if="d.protected" class="diff-protected">보호됨</span>
            <template v-else>
              <span class="diff-old">{{ formatValue(d.oldValue) }}</span>
              <span class="diff-arrow">&rarr;</span>
              <span class="diff-new">{{ formatValue(d.newValue) }}</span>
            </template>
          </div>
        </div>
        <div v-else-if="result.status === 'online'" class="no-changes">변경사항 없음</div>
      </div>
    </section>

    <!-- 배포 결과 -->
    <section v-if="deployResults.length > 0" class="deploy-section">
      <h3>배포 결과</h3>
      <div class="deploy-summary">
        <span class="summary-success">성공: {{ deployResults.filter(r => r.success).length }}</span>
        <span class="summary-fail">실패: {{ deployResults.filter(r => !r.success).length }}</span>
      </div>
      <div v-for="result in deployResults" :key="result.gatewayId" class="result-card" :class="{ success: result.success, fail: !result.success }">
        <div class="result-header">
          <strong>{{ result.gatewayId }}</strong> - {{ result.gatewayName }}
          <span class="result-status">{{ result.success ? '성공' : '실패' }}</span>
          <span class="result-duration">{{ result.duration }}ms</span>
        </div>
        <div v-if="result.error" class="result-error">{{ result.error }}</div>
        <div v-if="result.changedFields && result.changedFields.length > 0" class="result-changes">
          변경: {{ result.changedFields.join(', ') }}
        </div>
        <div v-if="result.serviceRestarted" class="result-restart">Zigbee2MQTT 재시작됨</div>
      </div>
    </section>

    <!-- 배포 확인 모달 -->
    <div v-if="showConfirmModal" class="modal-overlay" @click.self="showConfirmModal = false">
      <div class="modal-content">
        <h3>배포 확인</h3>
        <p>{{ selectedGateways.length }}개 게이트웨이에 설정을 배포합니다.</p>
        <p class="confirm-warning">설정 적용 후 MQTT 연결이 끊기면 60초 내 자동 롤백됩니다.</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showConfirmModal = false">취소</button>
          <button class="btn-primary" @click="executeDeploy">배포 실행</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { configDeployApi, type CommonConfig, type PreviewResult, type DeployResult } from '../api/config-deploy.api'
import { gatewayApi } from '../api/gateway.api'
import type { Gateway } from '../types/device.types'

const gateways = ref<Gateway[]>([])
const gatewaysLoading = ref(true)
const selectedGateways = ref<string[]>([])
const previewing = ref(false)
const deploying = ref(false)
const showConfirmModal = ref(false)
const previewResults = ref<PreviewResult[]>([])
const deployResults = ref<DeployResult[]>([])
const yamlExpanded = ref(true)

const config = reactive<CommonConfig>({
  homeassistant: false,
  frontend: { port: 8080, host: '0.0.0.0' },
  advanced: {
    log_level: 'info',
    channel: 11,
    last_seen: 'ISO_8601',
    legacy_api: false,
    legacy_availability_payload: false,
    log_output: ['console'],
  },
  availability: {
    active: { timeout: 10 },
    passive: { timeout: 1500 },
  },
  ota: {
    disable_automatic_update_check: true,
  },
})

const allSelected = computed(() =>
  gateways.value.length > 0 && selectedGateways.value.length === gateways.value.length
)

/** 배포될 YAML 미리보기 (실시간 반영) */
const configYaml = computed(() => {
  const lines: string[] = []
  lines.push(`homeassistant: ${config.homeassistant}`)
  lines.push('')
  lines.push('# --- 보호 필드 (게이트웨이별 기존 값 유지) ---')
  lines.push('# mqtt:')
  lines.push('#   base_topic: farm/{게이트웨이ID}/z2m  (변경 안 됨)')
  lines.push('#   server: mqtt://{서버IP}:1883         (변경 안 됨)')
  lines.push('# serial:')
  lines.push('#   port: /dev/ttyUSB0                   (변경 안 됨)')
  lines.push('# advanced.network_key: (변경 안 됨)')
  lines.push('# advanced.pan_id: (변경 안 됨)')
  lines.push('')
  lines.push('# --- 아래 설정이 배포됩니다 ---')
  lines.push('')
  lines.push('frontend:')
  lines.push(`  port: ${config.frontend?.port}`)
  lines.push(`  host: ${config.frontend?.host}`)
  lines.push('')
  lines.push('advanced:')
  lines.push(`  log_level: ${config.advanced?.log_level}`)
  lines.push('  log_output:')
  for (const out of config.advanced?.log_output || ['console']) {
    lines.push(`    - ${out}`)
  }
  lines.push(`  channel: ${config.advanced?.channel}`)
  lines.push(`  last_seen: ${config.advanced?.last_seen}`)
  lines.push(`  legacy_api: ${config.advanced?.legacy_api}`)
  lines.push(`  legacy_availability_payload: ${config.advanced?.legacy_availability_payload}`)
  lines.push('')
  lines.push('availability:')
  lines.push('  active:')
  lines.push(`    timeout: ${config.availability?.active?.timeout}`)
  lines.push('  passive:')
  lines.push(`    timeout: ${config.availability?.passive?.timeout}`)
  lines.push('')
  lines.push('ota:')
  lines.push(`  disable_automatic_update_check: ${config.ota?.disable_automatic_update_check}`)
  return lines.join('\n')
})

const configYamlSummary = computed(() => {
  return `log_level: ${config.advanced?.log_level}, channel: ${config.advanced?.channel}, frontend.port: ${config.frontend?.port}, availability.active: ${config.availability?.active?.timeout}분 ...`
})

function toggleAll() {
  if (allSelected.value) {
    selectedGateways.value = []
  } else {
    selectedGateways.value = gateways.value.map(g => g.gatewayId)
  }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    online: '온라인',
    offline: '오프라인',
    'no-agent': 'Agent 미응답',
  }
  return labels[status] || status
}

function formatValue(val: any): string {
  if (val === undefined || val === null) return '(없음)'
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  return String(val)
}

async function loadTemplate() {
  try {
    const { data } = await configDeployApi.getTemplate()
    Object.assign(config, data)
  } catch {
    // 기본값 사용
  }
}

async function loadGateways() {
  gatewaysLoading.value = true
  try {
    const { data } = await gatewayApi.getAll()
    gateways.value = data
  } catch {
    gateways.value = []
  } finally {
    gatewaysLoading.value = false
  }
}

async function runPreview() {
  previewing.value = true
  deployResults.value = []
  try {
    const { data } = await configDeployApi.preview(selectedGateways.value, config)
    previewResults.value = data
  } catch {
    previewResults.value = []
  } finally {
    previewing.value = false
  }
}

function confirmDeploy() {
  showConfirmModal.value = true
}

async function executeDeploy() {
  showConfirmModal.value = false
  deploying.value = true
  previewResults.value = []
  try {
    const { data } = await configDeployApi.deploy(selectedGateways.value, config)
    deployResults.value = data
  } catch {
    deployResults.value = []
  } finally {
    deploying.value = false
  }
}

onMounted(() => {
  loadTemplate()
  loadGateways()
})
</script>

<style scoped>
.deploy-section {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--card-bg, #fff);
  border-radius: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
}
.deploy-section h3 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}
.section-hint {
  color: var(--text-secondary, #6b7280);
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

/* Config form */
.config-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
}
.form-group select,
.form-group input[type="number"] {
  padding: 0.5rem;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  font-size: 0.9rem;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #111827);
}
.checkbox-group {
  flex-direction: row;
  align-items: center;
}
.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

/* YAML Preview */
.yaml-preview {
  margin-top: 1.5rem;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
}
.yaml-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 1rem;
  background: var(--hover-bg, #f3f4f6);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.yaml-preview-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary, #111827);
}
.btn-text {
  background: none;
  border: none;
  color: var(--primary, #2563eb);
  font-size: 0.8rem;
  cursor: pointer;
  font-weight: 500;
}
.yaml-code {
  margin: 0;
  padding: 1rem;
  font-size: 0.82rem;
  line-height: 1.5;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  background: var(--code-bg, #f9fafb);
  color: var(--text-primary, #111827);
  overflow-x: auto;
  white-space: pre;
}
.yaml-collapsed {
  padding: 0.6rem 1rem;
  font-size: 0.82rem;
  font-family: 'SF Mono', monospace;
  color: var(--text-secondary, #6b7280);
}
.yaml-protected-notice {
  padding: 0.6rem 1rem;
  background: #fef3c7;
  font-size: 0.8rem;
  color: #92400e;
  border-top: 1px solid #fde68a;
}
.yaml-protected-notice strong {
  display: block;
  margin-bottom: 0.25rem;
}
.yaml-protected-notice code {
  font-size: 0.78rem;
  word-break: break-all;
}

/* Gateway selector */
.gateway-selector {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.gateway-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.gateway-checkbox:hover {
  background: var(--hover-bg, #f3f4f6);
}
.gateway-checkbox.select-all {
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  padding-bottom: 0.75rem;
  margin-bottom: 0.25rem;
}
.gw-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.status-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  font-weight: 500;
}
.status-badge.online { background: #dcfce7; color: #166534; }
.status-badge.offline { background: #fee2e2; color: #991b1b; }
.status-badge.no-agent { background: #fef3c7; color: #92400e; }

/* Actions */
.deploy-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
}
.btn-primary {
  padding: 0.6rem 1.5rem;
  background: var(--primary, #2563eb);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 0.6rem 1.5rem;
  background: var(--card-bg, #fff);
  color: var(--text-primary, #111827);
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
}
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

/* Preview */
.preview-card, .result-card {
  padding: 1rem;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}
.preview-header, .result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.diff-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.diff-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--hover-bg, #f9fafb);
  border-radius: 4px;
  font-size: 0.85rem;
  font-family: 'SF Mono', monospace;
}
.diff-item.protected {
  opacity: 0.5;
}
.diff-field { font-weight: 500; min-width: 200px; }
.diff-old { color: #dc2626; text-decoration: line-through; }
.diff-arrow { color: var(--text-secondary, #9ca3af); }
.diff-new { color: #16a34a; font-weight: 600; }
.diff-protected { color: #92400e; font-size: 0.8rem; }
.no-changes { color: var(--text-secondary, #6b7280); font-size: 0.85rem; }

/* Deploy result */
.result-card.success { border-left: 3px solid #16a34a; }
.result-card.fail { border-left: 3px solid #dc2626; }
.result-status { font-weight: 600; }
.result-card.success .result-status { color: #16a34a; }
.result-card.fail .result-status { color: #dc2626; }
.result-duration { color: var(--text-secondary, #9ca3af); font-size: 0.8rem; margin-left: auto; }
.result-error { color: #dc2626; font-size: 0.85rem; margin-top: 0.25rem; }
.result-changes { font-size: 0.85rem; color: var(--text-secondary, #6b7280); margin-top: 0.25rem; }
.result-restart { font-size: 0.8rem; color: #2563eb; margin-top: 0.25rem; }
.deploy-summary {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
  font-weight: 600;
}
.summary-success { color: #16a34a; }
.summary-fail { color: #dc2626; }

/* Confirm modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: var(--card-bg, #fff);
  padding: 2rem;
  border-radius: 12px;
  max-width: 420px;
  width: 90%;
}
.modal-content h3 { margin: 0 0 1rem; }
.confirm-warning {
  font-size: 0.85rem;
  color: #92400e;
  background: #fef3c7;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin: 0.75rem 0;
}
.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}

.loading-state, .empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary, #6b7280);
}
</style>
