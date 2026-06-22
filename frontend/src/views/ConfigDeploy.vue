<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>설정 배포</h2>
        <p class="page-description">라즈베리파이 게이트웨이에 Zigbee2MQTT 설정을 원격 배포합니다</p>
      </div>
    </header>

    <!-- ━━━━━━━━━━━━ 워크플로우 A: N대 일괄 배포 ━━━━━━━━━━━━ -->
    <div class="workflow-group workflow-a">
      <header class="workflow-group-header">
        <h2>📦 Zigbee2MQTT 설정 일괄 배포 <span class="workflow-scope">(N대 동시)</span></h2>
        <p class="workflow-description">
          선택한 N개 게이트웨이에 동일한 Zigbee2MQTT 설정을 한 번에 배포합니다.
          배포 후 MQTT 단절 시 60초 내 자동 롤백. <strong>향후 변경 사항을 모든 PI에 일괄 적용하는 핵심 기능.</strong>
        </p>
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

    </div>
    <!-- ━━━━━━━━━━━━ 워크플로우 A 끝 ━━━━━━━━━━━━ -->


    <!-- ━━━━━━━━━━━━ 워크플로우 B: 게이트웨이별 customization ━━━━━━━━━━━━ -->
    <div class="workflow-group workflow-b">
      <header class="workflow-group-header">
        <h2>🔧 게이트웨이별 시스템 설정 <span class="workflow-scope">(1대씩 customization)</span></h2>
        <p class="workflow-description">
          각 라즈베리파이의 <strong>Wi-Fi / Hostname / Gateway ID / Server IP / Identity</strong>를 MQTT 기반으로 원격 변경합니다.
          양산 출하 시 1대씩 다른 값으로 customization하거나 운영 중 단발성 변경에 사용합니다.
          Z2M 설정 배포(워크플로우 A)와는 독립된 경로이며 결과는 실시간 WebSocket으로 표시됩니다.
        </p>
      </header>

      <section class="deploy-section">
      <div v-if="gateways.length === 0" class="empty-state">
        <p>등록된 게이트웨이가 없습니다.</p>
      </div>
      <div v-else class="system-config-list">
        <GatewaySystemConfigCard
          v-for="gw in gateways"
          :key="gw.id"
          :gateway="gw"
        />
      </div>
      </section>
    </div>
    <!-- ━━━━━━━━━━━━ 워크플로우 B 끝 ━━━━━━━━━━━━ -->

    <!-- 📚 운영자 안내 (접힘 가능) -->
    <details class="info-footer">
      <summary class="info-footer-title">
        📚 라즈베리파이 컴포넌트 및 배포 워크플로우 안내 <span class="info-footer-hint">(클릭하여 펼치기)</span>
      </summary>
    <section class="deploy-section components-section">
      <h3>라즈베리파이 설치 컴포넌트 및 배포 워크플로우</h3>
      <p class="section-hint">
        <code>setup.sh</code> 실행 시 자동 설치되는 컴포넌트와 출하 절차입니다.
        배포 절차 자체는 기존 그대로이며, <strong>2026-05 업데이트</strong>로 이머전시 페일오버 엔진이 추가되었습니다.
      </p>

      <div class="component-grid">
        <div class="component-card">
          <div class="component-name">
            <span class="badge-existing">기존</span> Zigbee2MQTT
          </div>
          <div class="component-detail">Zigbee 동글 ↔ MQTT 브릿지. 디바이스 페어링 / 센서 데이터 수집.</div>
          <div class="component-path"><code>/opt/zigbee2mqtt</code></div>
        </div>

        <div class="component-card">
          <div class="component-name">
            <span class="badge-existing">기존</span> Config Agent
          </div>
          <div class="component-detail">원격 설정(Wi-Fi / Hostname / Server IP) 적용 + 자동 롤백.</div>
          <div class="component-path"><code>/opt/smart-farm/config-agent</code></div>
        </div>

        <div class="component-card">
          <div class="component-name">
            <span class="badge-existing">기존</span> GPIO Agent
          </div>
          <div class="component-detail">온보드 GPIO 릴레이 제어 (BCM 핀 단위, gpioset).</div>
          <div class="component-path"><code>/opt/smart-farm/gpio-agent</code></div>
        </div>

        <div class="component-card highlight">
          <div class="component-name">
            <span class="badge-new">NEW</span> Fallback Engine
          </div>
          <div class="component-detail">
            서버 단절 시 자동 안전 동작 (이머전시 페일오버).<br>
            • 관수 ON 시점부터 30분 후 OFF<br>
            • 액비 즉시 OFF<br>
            • 환기팬/유동팬 35°C ON / 28°C OFF (기본 비활성)<br>
            • 개폐기 월별 스케줄 (4·5·10월 시간 제어, 6~9월 24h OPEN)<br>
            • 빗물 센서 ACTIVE → 즉시 CLOSE
          </div>
          <div class="component-path">
            <code>/opt/smart-farm/fallback-engine</code> &nbsp;|&nbsp;
            데이터: <code>/var/lib/smartfarm/fallback/</code> (rules.json + 이벤트 SQLite 큐)
          </div>
          <div class="component-actions">
            <router-link to="/emergency-failover" class="btn-link">
              이머전시 페일오버 설정 페이지 →
            </router-link>
          </div>
        </div>

        <div class="component-card">
          <div class="component-name">
            <span class="badge-existing">선택</span> Reverse SSH Tunnel
          </div>
          <div class="component-detail">서버에서 Pi 원격 SSH 접속 (--with-tunnel 옵션 또는 first-boot-init 자동).</div>
          <div class="component-path"><code>autossh</code> 기반</div>
        </div>
      </div>

      <h4 class="workflow-title">📋 라즈베리파이 배포 워크플로우 (변경 없음)</h4>
      <div class="workflow-box">
        <div class="workflow-block">
          <div class="workflow-header">🏗️ 골든 이미지 준비 (1회만)</div>
          <ol class="workflow-list">
            <li>마스터 Pi에서 <code>prepare-master.sh</code> 실행</li>
            <li>마스터 Pi 종료 → SD 추출 → Mac에서 <code>build-golden-image.sh</code></li>
            <li>결과: <code>golden-lgw-YYYYMMDD.img.xz</code></li>
          </ol>
        </div>

        <div class="workflow-block">
          <div class="workflow-header">🚚 Pi 1대당 출하 절차</div>
          <div class="workflow-stage"><strong>본부 / 개발서버</strong></div>
          <ol class="workflow-list" start="1">
            <li><code>bash clone-sd.sh golden-lgw.img.xz diskN</code></li>
            <li>SD 장착 → Pi 전원 ON</li>
            <li>자동: 본부 Wi-Fi 연결 → register → 개발서버 웹UI 자동 출현</li>
            <li>검증: 디바이스 1~2개 페어링 + 룰 1개 (통신 확인)</li>
            <li>
              설정 배포 → 4. 시스템 설정:
              <ul>
                <li>5-A. Hostname → <code>lgw-farm01</code> [적용] (Pi 재부팅 1~2분)</li>
                <li>5-B. Server IP → 프로덕션 IP [적용] (개발서버 웹UI에서 사라짐 = 정상)</li>
              </ul>
            </li>
          </ol>
          <div class="workflow-stage"><strong>본부 / 프로덕션 서버 웹UI</strong></div>
          <ol class="workflow-list" start="6">
            <li>같은 Pi (<code>lgw-farm01</code>) 자동 출현 확인 (디바이스/룰 비어있음 = 정상)</li>
            <li>설정 배포 → 4. 시스템 설정:
              <ul>
                <li>7-A. Wi-Fi → 농장 SSID/PW [적용] (본부 통신 끊김 = 정상)</li>
              </ul>
            </li>
            <li>Pi 전원 OFF → 농장 발송</li>
          </ol>
          <div class="workflow-stage"><strong>농장 현장</strong></div>
          <ol class="workflow-list" start="9">
            <li>Pi 전원 ON → 농장 Wi-Fi 자동 연결 → 프로덕션 reverse tunnel 자동 복구 → 🟢 online</li>
            <li>농장 디바이스 페어링 + 자동제어 룰 설정 (현장)</li>
          </ol>
        </div>
      </div>

      <div class="notice-box">
        <strong>💡 2026-05 업데이트 안내</strong>
        <ul>
          <li><strong>골든 이미지 재빌드 필요</strong> — Fallback Engine 추가, GPIO Agent payload 호환 (<code>{slot, pin, state, requestId}</code>) 반영</li>
          <li>현장 출하 후 → <a href="/emergency-failover">이머전시 페일오버 설정 페이지</a>에서 농장별 폴백 룰 편집 (월별 스케줄 / 임계값)</li>
          <li>온보드 장치 추가/삭제/핀 변경 시 → <strong>RPi에 자동 동기화됨</strong> (별도 설정 배포 불필요)</li>
          <li>장치 매핑은 서버 <code>gateway_onboard_devices</code> 테이블이 권위. RPi는 MQTT retained 메시지로 자동 수신.</li>
        </ul>
      </div>
    </section>
    </details>
    <!-- ━━━━━━━━━━━━ 안내 footer 끝 ━━━━━━━━━━━━ -->

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
import GatewaySystemConfigCard from '../components/config-deploy/GatewaySystemConfigCard.vue'

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
  background: var(--bg-card, #fff);
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
  background: var(--bg-input, #fff);
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
  background: var(--bg-hover, #f3f4f6);
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
  color: var(--accent, #2563eb);
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
  background: var(--bg-secondary, #f9fafb);
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
  background: var(--warning-bg, #fef3c7);
  font-size: 0.8rem;
  color: var(--warning-text, #92400e);
  border-top: 1px solid var(--warning-border, #fde68a);
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
  background: var(--bg-hover, #f3f4f6);
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
.status-badge.online { background: var(--success-bg, #dcfce7); color: var(--success-text, #166534); }
.status-badge.offline { background: var(--danger-badge-bg, #fee2e2); color: var(--danger-badge-text, #991b1b); }
.status-badge.no-agent { background: var(--warning-bg, #fef3c7); color: var(--warning-text, #92400e); }

/* Actions */
.deploy-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
}
.btn-primary {
  padding: 0.6rem 1.5rem;
  background: var(--accent, #2563eb);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 0.6rem 1.5rem;
  background: var(--bg-card, #fff);
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
  background: var(--bg-hover, #f9fafb);
  border-radius: 4px;
  font-size: 0.85rem;
  font-family: 'SF Mono', monospace;
}
.diff-item.protected {
  opacity: 0.5;
}
.diff-field { font-weight: 500; min-width: 200px; }
.diff-old { color: var(--diff-old, #dc2626); text-decoration: line-through; }
.diff-arrow { color: var(--text-secondary, #9ca3af); }
.diff-new { color: var(--diff-new, #16a34a); font-weight: 600; }
.diff-protected { color: var(--warning-text, #92400e); font-size: 0.8rem; }
.no-changes { color: var(--text-secondary, #6b7280); font-size: 0.85rem; }

/* Deploy result */
.result-card.success { border-left: 3px solid var(--diff-new, #16a34a); }
.result-card.fail { border-left: 3px solid var(--diff-old, #dc2626); }
.result-status { font-weight: 600; }
.result-card.success .result-status { color: var(--diff-new, #16a34a); }
.result-card.fail .result-status { color: var(--diff-old, #dc2626); }
.result-duration { color: var(--text-secondary, #9ca3af); font-size: 0.8rem; margin-left: auto; }
.result-error { color: var(--diff-old, #dc2626); font-size: 0.85rem; margin-top: 0.25rem; }
.result-changes { font-size: 0.85rem; color: var(--text-secondary, #6b7280); margin-top: 0.25rem; }
.result-restart { font-size: 0.8rem; color: var(--accent, #2563eb); margin-top: 0.25rem; }
.deploy-summary {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
  font-weight: 600;
}
.summary-success { color: var(--diff-new, #16a34a); }
.summary-fail { color: var(--diff-old, #dc2626); }

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
  background: var(--bg-card, #fff);
  padding: 2rem;
  border-radius: 12px;
  max-width: 420px;
  width: 90%;
}
.modal-content h3 { margin: 0 0 1rem; }
.confirm-warning {
  font-size: 0.85rem;
  color: var(--warning-text, #92400e);
  background: var(--warning-bg, #fef3c7);
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

/* ───── Section 5: 라즈베리파이 컴포넌트 + 워크플로우 ───── */
.components-section { margin-top: 2rem; }
.components-section h4.workflow-title {
  margin-top: 2rem; margin-bottom: 0.75rem;
  font-size: 1rem; color: var(--text, #1f2937);
}

.component-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem; margin-top: 1rem;
}
.component-card {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 6px;
}
.component-card.highlight {
  background: linear-gradient(135deg, #f0f7ff 0%, #e6f0ff 100%);
  border-color: #60a5fa;
}
.component-name {
  font-weight: 600; font-size: 0.95rem;
  display: flex; align-items: center; gap: 6px;
}
.component-detail {
  font-size: 0.85rem; line-height: 1.5;
  color: var(--text-secondary, #4b5563);
}
.component-path {
  font-size: 0.75rem; color: var(--text-secondary, #6b7280);
}
.component-path code {
  background: var(--code-bg, #f3f4f6); padding: 1px 6px;
  border-radius: 3px; font-size: 0.7rem;
}
.component-actions { margin-top: 6px; }
.btn-link {
  display: inline-block; padding: 4px 8px;
  background: #3b82f6; color: #fff;
  border-radius: 4px; font-size: 0.8rem;
  text-decoration: none;
}
.btn-link:hover { background: #2563eb; }

.badge-existing, .badge-new {
  font-size: 0.65rem; padding: 2px 6px;
  border-radius: 4px; font-weight: 700;
}
.badge-existing { background: #e5e7eb; color: #374151; }
.badge-new { background: #fef3c7; color: #92400e; }

.workflow-box {
  display: grid; grid-template-columns: 1fr 2fr; gap: 1rem;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px; padding: 1rem;
}
@media (max-width: 900px) {
  .workflow-box { grid-template-columns: 1fr; }
}
.workflow-block { font-size: 0.85rem; line-height: 1.6; }
.workflow-header {
  font-weight: 700; margin-bottom: 0.5rem;
  color: var(--text, #1f2937);
}
.workflow-stage {
  margin-top: 0.75rem; margin-bottom: 0.25rem;
  font-size: 0.8rem; color: #4338ca;
}
.workflow-list {
  margin: 0; padding-left: 1.25rem;
  color: var(--text-secondary, #4b5563);
}
.workflow-list li { margin-bottom: 4px; }
.workflow-list ul { padding-left: 1rem; margin-top: 4px; }
.workflow-list code, .workflow-block code {
  background: var(--code-bg, #f3f4f6); padding: 1px 5px;
  border-radius: 3px; font-size: 0.8em;
}

.notice-box {
  margin-top: 1.25rem; padding: 12px 16px;
  background: #fef3c7; border-left: 4px solid #f59e0b;
  border-radius: 6px; font-size: 0.85rem; line-height: 1.6;
}
.notice-box strong { display: block; margin-bottom: 6px; color: #92400e; }
.notice-box ul { margin: 0; padding-left: 1.25rem; color: #78350f; }
.notice-box a { color: #1d4ed8; text-decoration: underline; }
.notice-box code {
  background: rgba(0,0,0,0.06); padding: 1px 4px;
  border-radius: 3px; font-size: 0.85em;
}

/* ━━━━━━━━━ 워크플로우 그룹 (2026-05-25 ConfigDeploy UX 정리) ━━━━━━━━━ */
.workflow-group {
  border: 2px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  padding: 20px;
  margin: 24px 0;
  background: var(--color-bg-secondary, #fafbfc);
}
.workflow-group.workflow-a {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.04);
}
.workflow-group.workflow-b {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.04);
}
.workflow-group-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--color-border, #cbd5e0);
}
.workflow-group-header h2 {
  margin: 0 0 8px; font-size: 18px; color: var(--color-text, #1f2937);
}
.workflow-scope {
  font-size: 13px; color: var(--color-text-secondary, #6b7280);
  font-weight: 400;
}
.workflow-description {
  margin: 0; font-size: 13px; line-height: 1.6;
  color: var(--color-text-secondary, #4b5563);
}
.workflow-description strong { color: var(--color-text, #1f2937); }

/* 안내 footer (접힘) */
.info-footer {
  margin: 32px 0; padding: 16px 20px;
  background: var(--color-bg-secondary, #f8f9fa);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
}
.info-footer summary {
  cursor: pointer; font-size: 14px; font-weight: 600;
  color: var(--color-text, #1f2937);
  list-style: none; user-select: none;
}
.info-footer summary::-webkit-details-marker { display: none; }
.info-footer summary::before {
  content: '▶'; display: inline-block; margin-right: 6px;
  transition: transform 0.2s; color: var(--color-text-secondary, #6b7280);
}
.info-footer[open] summary::before { transform: rotate(90deg); }
.info-footer-hint {
  font-size: 11px; color: var(--color-text-secondary, #9ca3af);
  font-weight: 400; margin-left: 4px;
}
.info-footer[open] .info-footer-hint { display: none; }
.info-footer .components-section {
  margin-top: 16px; padding: 0; background: transparent;
  border-top: 1px dashed var(--color-border, #cbd5e0);
}

@media (max-width: 768px) {
  .page-container { padding: 4px 0; }
}
</style>
