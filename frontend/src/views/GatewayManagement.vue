<template>
  <div class="page-container">
    <!-- 페이지 헤더 -->
    <header class="page-header">
      <div class="page-header-text">
        <h2>게이트웨이 관리</h2>
        <p class="page-description">농장별로 라즈베리파이 게이트웨이를 관리합니다</p>
      </div>
      <div class="page-header-actions">
        <button class="btn-ghost" @click="refreshGateways" :disabled="loading" aria-label="새로고침">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          새로고침
        </button>
        <button class="btn-primary" @click="showAddModal = true">
          <span class="plus-sign">+</span> 게이트웨이 등록
        </button>
      </div>
    </header>

    <!-- 툴바: 검색 + 필터 + 그룹화 -->
    <div class="toolbar" v-if="!loading && gateways.length > 0">
      <div class="toolbar-left">
        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="게이트웨이 이름, 농장, 위치로 검색"
            class="search-input"
          />
        </div>
        <div class="filter-chips" role="tablist">
          <button
            v-for="opt in filterOptions"
            :key="opt.value"
            class="chip"
            :class="{ active: statusFilter === opt.value }"
            role="tab"
            :aria-selected="statusFilter === opt.value"
            @click="statusFilter = opt.value"
          >
            {{ opt.label }}
            <span class="chip-count">{{ statusCounts[opt.value] }}</span>
          </button>
        </div>
      </div>
      <div class="toolbar-right">
        <span class="toolbar-label">그룹화</span>
        <div class="segmented">
          <button
            v-for="opt in groupOptions"
            :key="opt.value"
            class="seg-btn"
            :class="{ active: groupMode === opt.value }"
            @click="groupMode = opt.value"
          >{{ opt.label }}</button>
        </div>
      </div>
    </div>

    <!-- 로딩/빈상태 -->
    <div v-if="loading" class="loading-state">불러오는 중...</div>
    <div v-else-if="gateways.length === 0" class="empty-state">
      <p>등록된 게이트웨이가 없습니다.</p>
    </div>
    <div v-else-if="filteredGateways.length === 0" class="empty-state">
      <p>조건에 맞는 게이트웨이가 없습니다.</p>
    </div>

    <!-- 그룹화된 게이트웨이 -->
    <div v-else class="groups-container">
      <section v-for="grp in groupedGateways" :key="grp.key" class="farm-group">
        <!-- 농장 그룹 헤더 (groupMode='farm' 일 때만) -->
        <div v-if="groupMode === 'farm'" class="farm-group-header">
          <div class="farm-group-header-left">
            <div class="farm-avatar" :style="{ background: farmAvatarColor(grp.key) }">
              {{ farmAvatarInitial(grp.label) }}
            </div>
            <div class="farm-info">
              <div class="farm-name">{{ grp.label }}</div>
              <div class="farm-sub">
                {{ grp.subtitle }}
              </div>
            </div>
          </div>
          <div class="farm-group-header-right">
            <span v-if="grp.okCount > 0" class="farm-badge badge-ok">● {{ grp.okCount }} 정상</span>
            <span v-if="grp.warnCount > 0" class="farm-badge badge-warn">● {{ grp.warnCount }} 미운영</span>
          </div>
        </div>
        <!-- 상태 그룹 헤더 (groupMode='status') -->
        <div v-else-if="groupMode === 'status'" class="status-group-header">
          <h3>{{ grp.label }} <span class="muted">({{ grp.items.length }})</span></h3>
        </div>

        <!-- 카드 그리드 -->
        <div class="gateway-grid">
          <article
            v-for="gw in grp.items"
            :key="gw.id"
            class="gateway-card"
            :class="{ 'card-warn': !isGatewayOk(gw) }"
          >
            <!-- 헤더 행 -->
            <div class="card-header">
              <div class="card-header-left">
                <span
                  class="status-dot"
                  :class="{ ok: effectiveAgentOnline(gw), warn: !effectiveAgentOnline(gw) }"
                ></span>
                <div class="card-title-wrap">
                  <div class="card-title-row">
                    <span class="gateway-name">{{ gw.name }}</span>
                    <code class="gateway-id-chip">{{ gw.gatewayId }}</code>
                  </div>
                </div>
              </div>
              <div class="card-header-right">
                <button
                  class="kebab-btn"
                  :aria-label="`${gw.name} 메뉴`"
                  @click.stop="kebabOpen = kebabOpen === gw.id ? null : gw.id"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                  </svg>
                </button>
                <!-- 케밥 드롭다운 -->
                <div
                  v-if="kebabOpen === gw.id"
                  v-click-outside="() => { kebabOpen = null }"
                  class="kebab-menu"
                  role="menu"
                >
                  <button class="kebab-item" role="menuitem" @click="openZoneEditor(gw)">
                    구역 변경
                  </button>
                  <button class="kebab-item" role="menuitem" @click="openPiModal(gw)">
                    Pi 설치 명령 보기
                  </button>
                  <button
                    v-if="effectiveTunnelConnected(gw) && gw.tunnelPort"
                    class="kebab-item"
                    role="menuitem"
                    @click="copyCommandFromMenu(gw)"
                  >SSH 명령 복사</button>
                  <button class="kebab-item" role="menuitem" @click="editGatewayFromMenu(gw)">
                    편집
                  </button>
                  <div class="kebab-divider"></div>
                  <button class="kebab-item danger" role="menuitem" @click="removeGatewayFromMenu(gw)">
                    삭제
                  </button>
                </div>
              </div>
            </div>

            <!-- 위치 행 -->
            <div v-if="gw.location" class="card-location">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>{{ gw.location }}</span>
            </div>

            <!-- 이슈 배너 -->
            <div v-if="issueOf(gw)" class="card-issue" :class="issueOf(gw)?.severity">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>{{ issueOf(gw)?.message }}</span>
            </div>

            <!-- Connection Strip (AGENT / ZIGBEE / SSH 3분할) -->
            <div class="conn-strip">
              <div class="conn-cell">
                <div class="conn-label">AGENT</div>
                <div class="conn-value">
                  <span class="dot-sm" :class="effectiveAgentOnline(gw) ? 'dot-ok' : 'dot-off'"></span>
                  {{ effectiveAgentOnline(gw) ? '온라인' : '오프라인' }}
                </div>
              </div>
              <div class="conn-cell">
                <div class="conn-label">ZIGBEE</div>
                <div class="conn-value">
                  <span class="dot-sm" :class="gw.zigbeeStatus === 'online' ? 'dot-ok' : 'dot-off'"></span>
                  {{ gw.zigbeeStatus === 'online' ? '연결' : '미연결' }}
                </div>
              </div>
              <div class="conn-cell">
                <div class="conn-label">SSH</div>
                <div class="conn-value">
                  <span class="dot-sm" :class="effectiveTunnelConnected(gw) ? 'dot-ok' : 'dot-off'"></span>
                  <code v-if="effectiveTunnelConnected(gw) && gw.tunnelPort" class="port">
                    :{{ gw.tunnelPort }}
                  </code>
                  <span v-else>미연결</span>
                </div>
              </div>
            </div>

            <!-- 구역 + 마지막통신 -->
            <div class="card-meta-row">
              <div class="zone-tag-wrap">
                <span v-if="zoneEditingGw === gw.id" class="zone-inline-edit">
                  <select
                    class="zone-select-inline"
                    :value="gw.groupId || ''"
                    @change="onZoneChange(gw, ($event.target as HTMLSelectElement).value)"
                    @blur="zoneEditingGw = null"
                    :disabled="zoneAssigning === gw.id"
                  >
                    <option value="">할당 안 함</option>
                    <option v-for="g in groupsForGateway(gw)" :key="g.id" :value="g.id">{{ g.name }}</option>
                  </select>
                  <span v-if="zoneAssigning === gw.id" class="zone-saving">저장 중…</span>
                </span>
                <span v-else>
                  <span v-if="gw.groupName" class="zone-tag zone-assigned">● {{ gw.groupName }}</span>
                  <span v-else class="zone-tag zone-warn">구역 미할당</span>
                </span>
              </div>
              <div v-if="gw.lastSeen" class="last-seen muted">{{ formatLastSeen(gw.lastSeen) }}</div>
            </div>

            <!-- 액션 버튼 -->
            <div class="card-actions">
              <button
                v-if="effectiveTunnelConnected(gw) && gw.tunnelPort"
                class="btn-action-primary"
                @click="openTerminal(gw)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5"/>
                  <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                터미널
              </button>
              <button
                v-else
                class="btn-action"
                @click="refreshGateways"
                :title="'터널 미연결 — 새로고침으로 상태 갱신'"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                재연결 시도
              </button>
              <button class="btn-action" @click="router.push(`/gateways/${gw.id}/env`)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                환경 설정
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <!-- 웹 터미널 오버레이 -->
    <div v-if="terminalGateway" class="terminal-overlay" @click.self="terminalGateway = null">
      <div class="terminal-panel">
        <WebTerminal
          :gateway-id="terminalGateway.gatewayId"
          :gateway-name="terminalGateway.name"
          @close="terminalGateway = null"
        />
      </div>
    </div>

    <!-- SSH 명령 모달 (사용 안 함 — 케밥에서 즉시 복사) -->

    <!-- Pi 설치 명령 모달 -->
    <div v-if="piModalGw" class="modal-overlay" @click.self="piModalGw = null">
      <div class="modal modal-cmd">
        <div class="modal-header">
          <h3>Pi 설치 명령 — {{ piModalGw.name }}</h3>
          <button class="modal-close" @click="piModalGw = null" aria-label="닫기">✕</button>
        </div>
        <p class="setup-desc">라즈베리파이에서 아래 명령을 실행하세요:</p>
        <pre class="setup-cmd">{{ buildSetupCommand(piModalGw) }}</pre>
        <div class="modal-actions">
          <button class="btn-secondary" @click="piModalGw = null">닫기</button>
          <button class="btn-primary" @click="piModalGw && copySetupCommand(piModalGw)">
            {{ piModalGw && copiedSetup === piModalGw.id ? '✓ 복사됨' : '복사' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 게이트웨이 등록/편집 모달 -->
    <div v-if="showAddModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editTarget ? '게이트웨이 편집' : '게이트웨이 등록' }}</h3>
          <button class="modal-close" @click="closeModal" aria-label="닫기">✕</button>
        </div>
        <div class="form-group">
          <label>게이트웨이 ID (고유값)</label>
          <input v-model="form.gatewayId" :disabled="!!editTarget" placeholder="예: lgw-farm01" />
        </div>
        <div class="form-group">
          <label>이름</label>
          <input v-model="form.name" placeholder="예: 횡성 1호 농장" />
        </div>
        <div class="form-group">
          <label>위치</label>
          <input v-model="form.location" placeholder="예: 강원도 횡성군" />
        </div>
        <!-- 라즈베리파이 IP는 Pi가 부팅 시 first-boot-init 으로 자동 보고 → DB에 자동 채워짐.
             등록 모드에서는 숨기고, 편집 모드에서는 read-only로 표시. -->
        <div v-if="editTarget" class="form-group">
          <label>라즈베리파이 IP <small style="color:#94a3b8">(자동 보고)</small></label>
          <input v-model="form.rpiIp" readonly placeholder="(Pi 부팅 후 자동 채워짐)"
                 style="background:#f1f5f9; color:#64748b; cursor:not-allowed;" />
        </div>
        <div v-else class="form-group">
          <p style="margin:4px 0; padding:10px 12px; background:#eff6ff; color:#1e40af;
                     border-radius:6px; font-size:13px; line-height:1.5;">
            💡 라즈베리파이의 IP·machineId·hostname 등은 Pi 첫 부팅 시 자동으로 보고됩니다.
            여기서는 <strong>게이트웨이 ID</strong>만 미리 만들어 두면 Pi가 자동 등록됩니다.
          </p>
        </div>
        <div class="form-group">
          <label>소유 농장</label>
          <select v-model="form.userId">
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }} ({{ u.username }})</option>
          </select>
        </div>
        <div class="form-group">
          <label>연결 구역</label>
          <select v-model="form.houseId">
            <option value="">미지정</option>
            <option v-for="h in houses" :key="h.id" :value="h.id">{{ h.name }}</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="closeModal">취소</button>
          <button class="btn-primary" @click="saveGateway" :disabled="saving">
            {{ saving ? '저장 중...' : '저장' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type Directive } from 'vue'
import { useRouter } from 'vue-router'
import { gatewayApi } from '@/api/gateway.api'
import { userApi } from '@/api/user.api'
import { groupApi } from '@/api/group.api'
import { useNotificationStore } from '@/stores/notification.store'
import WebTerminal from '@/components/gateway/WebTerminal.vue'
import { useWebSocket } from '@/composables/useWebSocket'
import type { HouseGroupWithOwner } from '@/types/group.types'

interface GatewayWithTunnel {
  id: string
  gatewayId: string
  name: string
  location?: string
  rpiIp?: string
  userId: string
  houseId?: string | null
  groupId?: string | null
  groupName?: string | null
  agentStatus: string
  zigbeeStatus: string
  tunnelPort?: number
  tunnelStatus: string
  tunnelLastSeen?: string
  lastSeen?: string
}

const AGENT_STALE_MS = 5 * 60 * 1000
const TUNNEL_STALE_MS = 3 * 60 * 1000

function effectiveAgentOnline(gw: GatewayWithTunnel): boolean {
  if (gw.agentStatus !== 'online') return false
  if (!gw.lastSeen) return true
  return Date.now() - new Date(gw.lastSeen).getTime() <= AGENT_STALE_MS
}

function effectiveTunnelConnected(gw: GatewayWithTunnel): boolean {
  if (gw.tunnelStatus !== 'connected') return false
  if (!gw.tunnelLastSeen) return true
  return Date.now() - new Date(gw.tunnelLastSeen).getTime() <= TUNNEL_STALE_MS
}

const router = useRouter()
const notif = useNotificationStore()
const { on, off } = useWebSocket()

const gateways = ref<GatewayWithTunnel[]>([])
const loading = ref(false)
const terminalGateway = ref<GatewayWithTunnel | null>(null)
const copied = ref<string | null>(null)
const copiedSetup = ref<string | null>(null)
const showSetup = ref<string | null>(null)
const showAddModal = ref(false)
const editTarget = ref<GatewayWithTunnel | null>(null)
const saving = ref(false)
const zoneAssigning = ref<string | null>(null)
const users = ref<{ id: string; name: string; username: string }[]>([])
const houses = ref<{ id: string; name: string }[]>([])
const groups = ref<HouseGroupWithOwner[]>([])

const form = ref({ gatewayId: '', name: '', location: '', rpiIp: '', userId: '', houseId: '' })

const SERVER_HOST = import.meta.env.VITE_SERVER_HOST || (window.location.hostname === 'localhost' ? '172.30.1.42' : window.location.hostname)

function handleGatewayStatus(data: { gatewayId: string; agentStatus: string }) {
  const gw = gateways.value.find(g => g.id === data.gatewayId)
  if (gw) {
    gw.agentStatus = data.agentStatus
    gw.lastSeen = new Date().toISOString()
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const [gwRes, userRes, houseRes, groupRes] = await Promise.all([
      gatewayApi.getAll(),
      userApi.getAll().catch(() => ({ data: [] })),
      groupApi.getHouses().catch(() => ({ data: [] })),
      groupApi.adminGetAllGroups().catch(() => ({ data: [] })),
    ])
    gateways.value = gwRes.data as unknown as GatewayWithTunnel[]
    users.value = (userRes.data as any[]).filter(u => u.role !== 'farm_user')
    houses.value = houseRes.data as any[]
    groups.value = groupRes.data as any[]
  } finally {
    loading.value = false
  }
  on('gateway:status', handleGatewayStatus)
})

onBeforeUnmount(() => {
  off('gateway:status', handleGatewayStatus)
})

function farmNameOf(userId: string): string {
  const u = users.value.find(u => u.id === userId)
  return u ? u.name : '알 수 없음'
}

function farmUsernameOf(userId: string): string {
  const u = users.value.find(u => u.id === userId)
  return u ? u.username : ''
}

function groupsForGateway(gw: GatewayWithTunnel): HouseGroupWithOwner[] {
  return groups.value.filter(g => g.userId === gw.userId)
}

function buildSetupCommand(gw: GatewayWithTunnel) {
  const backendUrl = `http://${SERVER_HOST}:3100`
  const scriptUrl = `${backendUrl}/api/gateways/setup/tunnel-setup.sh`
  return `curl -fsSL "${scriptUrl}" -o /tmp/tunnel-setup.sh && \\\nsudo env GATEWAY_ID=${gw.gatewayId} \\\n  BACKEND_URL=${backendUrl} \\\n  SERVER_HOST=${SERVER_HOST} \\\n  SERVER_USER=ohjeongseok \\\n  bash /tmp/tunnel-setup.sh`
}

async function copyCommand(gw: GatewayWithTunnel) {
  await navigator.clipboard.writeText(`ssh -p ${gw.tunnelPort} lgw-dev@localhost`)
  copied.value = gw.id
  setTimeout(() => { copied.value = null }, 2000)
}

async function copySetupCommand(gw: GatewayWithTunnel) {
  await navigator.clipboard.writeText(buildSetupCommand(gw).replace(/\\\n  /g, ' '))
  copiedSetup.value = gw.id
  setTimeout(() => { copiedSetup.value = null }, 2000)
}

function toggleSetup(id: string) {
  showSetup.value = showSetup.value === id ? null : id
}

function editGateway(gw: GatewayWithTunnel) {
  editTarget.value = gw
  form.value = { gatewayId: gw.gatewayId, name: gw.name, location: gw.location || '', rpiIp: gw.rpiIp || '', userId: gw.userId, houseId: gw.houseId || '' }
  showAddModal.value = true
}

function closeModal() {
  showAddModal.value = false
  editTarget.value = null
  form.value = { gatewayId: '', name: '', location: '', rpiIp: '', userId: '', houseId: '' }
}

async function saveGateway() {
  if (!form.value.gatewayId || !form.value.name) {
    notif.warning('입력 오류', '게이트웨이 ID와 이름은 필수입니다.')
    return
  }
  saving.value = true
  try {
    if (editTarget.value) {
      await gatewayApi.update(editTarget.value.id, { name: form.value.name, location: form.value.location, rpiIp: form.value.rpiIp, userId: form.value.userId, houseId: form.value.houseId || null })
      notif.success('수정 완료', '게이트웨이 정보가 수정되었습니다.')
    } else {
      await gatewayApi.create({ gatewayId: form.value.gatewayId, name: form.value.name, location: form.value.location, rpiIp: form.value.rpiIp, userId: form.value.userId })
      notif.success('등록 완료', '게이트웨이가 등록되었습니다.')
    }
    const { data } = await gatewayApi.getAll()
    gateways.value = data as unknown as GatewayWithTunnel[]
    closeModal()
  } catch {
    notif.error('오류', '저장 중 오류가 발생했습니다.')
  } finally {
    saving.value = false
  }
}

async function onZoneChange(gw: GatewayWithTunnel, groupId: string) {
  if (zoneAssigning.value) return
  const newGroupId = groupId || null
  if (newGroupId === gw.groupId) return

  if (newGroupId && gw.groupId && newGroupId !== gw.groupId) {
    if (!confirm(`이 게이트웨이를 "${groupsForGateway(gw).find(g => g.id === newGroupId)?.name}" 구역으로 재할당할까요?`)) return
  }

  zoneAssigning.value = gw.id
  try {
    const res = await gatewayApi.assignZone(gw.id, newGroupId)
    const updated = res.data as any
    gw.groupId = updated.groupId
    gw.groupName = updated.groupName
    gw.houseId = updated.houseId
    notif.success('구역 할당', newGroupId ? `"${updated.groupName}" 구역에 할당되었습니다.` : '구역 할당이 해제되었습니다.')
    zoneEditingGw.value = null
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '구역 할당 중 오류가 발생했습니다.')
  } finally {
    zoneAssigning.value = null
  }
}

function openTerminal(gw: GatewayWithTunnel) {
  terminalGateway.value = gw
}

async function removeGateway(gw: GatewayWithTunnel) {
  if (!confirm(`"${gw.name}" 게이트웨이를 삭제할까요?`)) return
  try {
    await gatewayApi.remove(gw.id)
    gateways.value = gateways.value.filter(g => g.id !== gw.id)
    notif.success('삭제 완료', '게이트웨이가 삭제되었습니다.')
  } catch {
    notif.error('오류', '삭제 중 오류가 발생했습니다.')
  }
}

// ─────────────────────────────────────────────────────────────
// 신규 — 검색/필터/그룹화 + UI 상태
// ─────────────────────────────────────────────────────────────

const searchQuery = ref('')
const statusFilter = ref<'all' | 'ok' | 'warn'>('all')
const groupMode = ref<'farm' | 'status' | 'none'>('farm')
const kebabOpen = ref<string | null>(null)
const piModalGw = ref<GatewayWithTunnel | null>(null)
const zoneEditingGw = ref<string | null>(null)

const filterOptions = [
  { value: 'all' as const, label: '전체' },
  { value: 'ok' as const, label: '정상' },
  { value: 'warn' as const, label: '점검 필요' },
]
const groupOptions = [
  { value: 'farm' as const, label: '농장' },
  { value: 'status' as const, label: '상태' },
  { value: 'none' as const, label: '없음' },
]

function isGatewayOk(gw: GatewayWithTunnel): boolean {
  return effectiveAgentOnline(gw) && gw.zigbeeStatus === 'online' && effectiveTunnelConnected(gw)
}

const statusCounts = computed(() => {
  const result = { all: gateways.value.length, ok: 0, warn: 0 }
  for (const gw of gateways.value) {
    if (isGatewayOk(gw)) result.ok++
    else result.warn++
  }
  return result
})

const filteredGateways = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return gateways.value.filter(gw => {
    if (statusFilter.value === 'ok' && !isGatewayOk(gw)) return false
    if (statusFilter.value === 'warn' && isGatewayOk(gw)) return false
    if (q.length === 0) return true
    const farm = farmNameOf(gw.userId).toLowerCase()
    return (
      gw.name.toLowerCase().includes(q) ||
      gw.gatewayId.toLowerCase().includes(q) ||
      (gw.location || '').toLowerCase().includes(q) ||
      farm.includes(q)
    )
  })
})

interface GroupBucket {
  key: string
  label: string
  subtitle: string
  okCount: number
  warnCount: number
  items: GatewayWithTunnel[]
}

const groupedGateways = computed<GroupBucket[]>(() => {
  const items = filteredGateways.value
  if (groupMode.value === 'none') {
    return [{ key: '_all', label: '전체', subtitle: '', okCount: 0, warnCount: 0, items }]
  }
  if (groupMode.value === 'status') {
    const ok = items.filter(g => isGatewayOk(g))
    const warn = items.filter(g => !isGatewayOk(g))
    const out: GroupBucket[] = []
    if (ok.length > 0) out.push({ key: 'ok', label: '정상', subtitle: '', okCount: ok.length, warnCount: 0, items: ok })
    if (warn.length > 0) out.push({ key: 'warn', label: '점검 필요', subtitle: '', okCount: 0, warnCount: warn.length, items: warn })
    return out
  }
  // farm grouping
  const map = new Map<string, GatewayWithTunnel[]>()
  for (const gw of items) {
    const key = gw.userId
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(gw)
  }
  return Array.from(map.entries()).map(([userId, list]) => {
    const okCount = list.filter(g => isGatewayOk(g)).length
    const warnCount = list.length - okCount
    const username = farmUsernameOf(userId)
    const subtitle = `${username ? '@' + username + ' · ' : ''}게이트웨이 ${list.length}대${okCount > 0 ? ` · 정상 ${okCount}대` : ''}`
    return {
      key: userId,
      label: farmNameOf(userId),
      subtitle,
      okCount,
      warnCount,
      items: list,
    }
  })
})

// 농장 아바타 색상 — 6색 팔레트 + userId 해시
const FARM_PALETTE = ['#5B9BE6', '#7e57c2', '#26a69a', '#ef6c00', '#8e63b5', '#00897b']
function farmAvatarColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return FARM_PALETTE[h % FARM_PALETTE.length]
}
function farmAvatarInitial(label: string): string {
  return (label || '?').charAt(0).toUpperCase()
}

// 카드 이슈 (Zigbee 미연결, 오프라인, 터널 미연결)
function issueOf(gw: GatewayWithTunnel): { severity: 'warn' | 'error'; message: string } | null {
  if (!effectiveAgentOnline(gw)) return { severity: 'error', message: 'Agent 오프라인 — 게이트웨이 연결 확인 필요' }
  if (gw.zigbeeStatus !== 'online') return { severity: 'warn', message: 'Zigbee 미연결 — 무선 환경 확인' }
  if (!effectiveTunnelConnected(gw)) return { severity: 'warn', message: 'SSH 터널 끊김 — 원격 접속 불가' }
  return null
}

function formatLastSeen(iso: string): string {
  const now = Date.now()
  const t = new Date(iso).getTime()
  const diff = Math.max(0, Math.floor((now - t) / 1000))
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}

async function refreshGateways() {
  loading.value = true
  try {
    const { data } = await gatewayApi.getAll()
    gateways.value = data as unknown as GatewayWithTunnel[]
  } catch {
    notif.error('오류', '게이트웨이 목록을 갱신하지 못했습니다.')
  } finally {
    loading.value = false
  }
}

// 케밥 메뉴 — 기존 핸들러 호출 후 메뉴 닫기
function openZoneEditor(gw: GatewayWithTunnel) {
  zoneEditingGw.value = gw.id
  kebabOpen.value = null
}
function openPiModal(gw: GatewayWithTunnel) {
  toggleSetup(gw.id)
  piModalGw.value = gw
  kebabOpen.value = null
}
async function copyCommandFromMenu(gw: GatewayWithTunnel) {
  await copyCommand(gw)
  kebabOpen.value = null
  notif.success('복사 완료', 'SSH 명령이 클립보드에 복사되었습니다.')
}
function editGatewayFromMenu(gw: GatewayWithTunnel) {
  editGateway(gw)
  kebabOpen.value = null
}
function removeGatewayFromMenu(gw: GatewayWithTunnel) {
  kebabOpen.value = null
  removeGateway(gw)
}

// click-outside 디렉티브 (간단 구현)
const vClickOutside: Directive<HTMLElement, () => void> = {
  mounted(el, binding) {
    const handler = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) binding.value()
    }
    ;(el as any).__clickOutside = handler
    setTimeout(() => document.addEventListener('click', handler), 0)
  },
  unmounted(el) {
    const handler = (el as any).__clickOutside
    if (handler) document.removeEventListener('click', handler)
  },
}
</script>

<style scoped>
.page-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

/* 페이지 헤더 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}
.page-header-text h2 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}
.page-description {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}
.page-header-actions { display: flex; gap: 8px; }

/* 툴바 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.toolbar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.toolbar-label { font-size: 12px; color: var(--text-muted); }

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 360px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  padding: 0 10px;
  height: 38px;
}
.search-box svg { color: var(--text-muted); flex-shrink: 0; }
.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  padding: 0 8px;
  color: var(--text-primary);
}

.filter-chips { display: flex; gap: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.chip:hover { border-color: var(--accent); color: var(--accent); }
.chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.chip-count {
  font-size: 11px;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.1);
  padding: 1px 6px;
  border-radius: 10px;
}
.chip.active .chip-count { background: rgba(255, 255, 255, 0.25); color: #fff; }

.segmented {
  display: inline-flex;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.seg-btn {
  padding: 7px 14px;
  background: transparent;
  border: none;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border-right: 1px solid var(--border-color);
  transition: all 0.15s ease;
}
.seg-btn:last-child { border-right: none; }
.seg-btn:hover { background: var(--bg-hover); }
.seg-btn.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* 그룹 컨테이너 */
.groups-container { display: flex; flex-direction: column; gap: 28px; }

/* 농장 그룹 헤더 */
.farm-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
}
.farm-group-header-left { display: flex; align-items: center; gap: 12px; }
.farm-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.farm-info { display: flex; flex-direction: column; }
.farm-name { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.farm-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.farm-group-header-right { display: flex; gap: 6px; }
.farm-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.badge-ok { background: var(--success-bg); color: var(--success-text); }
.badge-warn { background: var(--bg-badge); color: var(--text-muted); }

/* 상태 그룹 헤더 */
.status-group-header {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-light);
}
.status-group-header h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); }
.muted { color: var(--text-muted); font-weight: 500; }

/* 카드 그리드 */
.gateway-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 14px;
}

/* 카드 */
.gateway-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.gateway-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border-color: var(--accent);
}

/* 카드 헤더 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.card-header-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.ok {
  background: var(--accent);
  box-shadow: 0 0 0 2.5px rgba(76, 175, 80, 0.16);
}
.status-dot.warn { background: var(--text-muted); }
.card-title-wrap { flex: 1; min-width: 0; }
.card-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gateway-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.gateway-id-chip {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: var(--bg-badge);
  color: var(--text-muted);
  padding: 1px 6px;
  border-radius: 4px;
}

/* 케밥 버튼 + 메뉴 */
.card-header-right { position: relative; flex-shrink: 0; }
.kebab-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.kebab-btn:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--text-muted); }
.kebab-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 180px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.1));
  padding: 4px;
  z-index: 50;
  display: flex; flex-direction: column;
}
.kebab-item {
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s;
}
.kebab-item:hover { background: var(--bg-hover); }
.kebab-item.danger { color: var(--danger); }
.kebab-item.danger:hover { background: var(--danger-bg); }
.kebab-divider {
  height: 1px;
  background: var(--border-light);
  margin: 4px 0;
}

/* 위치 행 */
.card-location {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  margin-top: -4px;
}

/* 이슈 배너 */
.card-issue {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.4;
}
.card-issue.warn {
  background: var(--warning-bg);
  color: var(--warning-text);
}
.card-issue.error {
  background: var(--danger-bg);
  color: var(--danger);
}
.card-issue svg { flex-shrink: 0; }

/* Connection Strip */
.conn-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg-hover);
  border: 1px solid var(--border-light);
  border-radius: 9px;
  overflow: hidden;
}
.conn-cell {
  padding: 10px 12px;
  border-right: 1px solid var(--border-light);
  display: flex; flex-direction: column; gap: 4px;
}
.conn-cell:last-child { border-right: none; }
.conn-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  text-transform: uppercase;
}
.conn-value {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.dot-sm {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok { background: var(--accent); }
.dot-off { background: var(--text-muted); }
.port {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--accent);
}

/* 카드 메타 행 (구역 + 마지막통신) */
.card-meta-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}
.zone-tag-wrap { flex: 1; min-width: 0; }
.zone-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.zone-assigned { background: var(--accent-bg); color: var(--accent); }
.zone-warn { background: var(--warning-bg); color: var(--warning-text); }
.zone-inline-edit { display: inline-flex; align-items: center; gap: 6px; }
.zone-select-inline {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-input);
  background: var(--bg-input);
  color: var(--text-primary);
  max-width: 200px;
}
.zone-saving { font-size: 11px; color: var(--text-muted); }
.last-seen { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

/* 액션 버튼 */
.card-actions {
  display: flex;
  gap: 8px;
}
.btn-action-primary, .btn-action {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-action-primary {
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
}
.btn-action-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.btn-action {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
.btn-action:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-hover);
}

/* 공용 버튼 */
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 9px;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s ease;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.plus-sign { font-size: 17px; line-height: 1; margin-top: -1px; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  padding: 9px 14px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
}
.btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
.btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease;
}
.btn-secondary:hover { background: var(--bg-hover); }

/* 모달 */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 999;
  backdrop-filter: blur(2px);
}
.modal {
  background: var(--bg-card);
  border-radius: 14px;
  padding: 24px;
  width: 460px;
  max-width: 90vw;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: var(--shadow-modal);
}
.modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 4px;
}
.modal-header h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); }
.modal-close {
  background: transparent;
  border: none;
  font-size: 18px;
  color: var(--text-muted);
  cursor: pointer;
  width: 28px; height: 28px;
  border-radius: 6px;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.modal-cmd { width: 600px; max-width: 95vw; }

.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.form-group input, .form-group select {
  height: 38px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  background: var(--bg-input);
  color: var(--text-primary);
}
.form-group input:focus, .form-group select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.15);
}

.modal-actions {
  display: flex; gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

/* Pi 설치 명령 모달 */
.setup-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}
.setup-cmd {
  background: #0d1117;
  color: #a8ff78;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  padding: 12px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
}

/* 터미널 */
.terminal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.terminal-panel {
  width: 100%;
  max-width: 900px;
  height: 560px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

.loading-state { padding: 40px; text-align: center; color: var(--text-secondary); }
.empty-state { padding: 60px; text-align: center; color: var(--text-secondary); }

/* 반응형 */
@media (max-width: 600px) {
  .page-container { padding: 16px; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar-right { justify-content: space-between; }
  .search-box { max-width: 100%; }
  .gateway-grid { grid-template-columns: 1fr; }
}
</style>
