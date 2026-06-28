<template>
  <div class="sys-card" :class="{ 'sys-card--collapsed': !expanded }">
    <header class="sys-card__header" @click="expanded = !expanded">
      <div class="sys-card__title">
        <strong>{{ gateway.gatewayId }}</strong>
        <span class="sys-card__name">{{ gateway.name }}</span>
        <span class="sys-card__status" :class="`status-${gateway.status}`">{{ gateway.status }}</span>
      </div>
      <button class="sys-card__toggle" type="button">{{ expanded ? '접기 ▲' : '시스템 설정 ▼' }}</button>
    </header>

    <div v-if="expanded" class="sys-card__body">
      <!-- Identity (hostname + gateway-id 통합) -->
      <section class="sys-row">
        <div class="sys-row__head">
          <h4>게이트웨이 이름 <span class="sub-label">(hostname + gateway-id 동시 변경)</span></h4>
          <RemoteConfigStatusBadge :status="states.identity_update.status" />
        </div>
        <div class="sys-row__form">
          <span class="current">현재: <code>{{ gateway.gatewayId }}</code></span>
          <input v-model="form.name" type="text" placeholder="lgw-farm01" :disabled="isPending('identity_update')" />
          <button class="btn" :disabled="!canApplyIdentity" @click="onApplyIdentity">적용</button>
        </div>
        <p class="detail-info">
          하나의 이름으로 hostname / gateway-id / MQTT topic / Z2M base_topic / 모든 agent 환경변수를 동시 갱신합니다.
        </p>
        <p v-if="states.identity_update.detail" class="detail">{{ states.identity_update.detail }}</p>
      </section>

      <!-- Wi-Fi -->
      <section class="sys-row">
        <div class="sys-row__head">
          <h4>Wi-Fi</h4>
          <RemoteConfigStatusBadge :status="states.wifi_update.status" :detail="states.wifi_update.detail" />
        </div>
        <div class="sys-row__form sys-row__form--wifi">
          <span class="current">현재 SSID: <code>{{ gateway.wifiSsid || '(미설정)' }}</code></span>
          <input v-model="form.ssid" type="text" placeholder="새 SSID" :disabled="isPending('wifi_update')" />
          <input v-model="form.psk" type="password" placeholder="비밀번호 (8~63자)" :disabled="isPending('wifi_update')" />
          <button class="btn" :disabled="!canApplyWifi" @click="onApplyWifi">적용</button>
        </div>
        <p class="warning">
          ⚠ 본사에서 농장 Wi-Fi로 변경 시 본사 인터넷 연결이 끊기는 것은 정상입니다.
          Pi를 농장에 설치하면 자동 연결됩니다. 비상시 LAN 직결 → <code>ssh lgw-default@192.168.0.100</code>
        </p>
        <p v-if="states.wifi_update.pingResult" class="detail">
          ping 결과: {{ states.wifi_update.pingResult.ok }} / {{ states.wifi_update.pingResult.tried }} 성공
        </p>
      </section>

      <!-- Gateway ID (legacy — 통합 endpoint 사용 권장, 분리 변경이 필요한 경우만) -->
      <section v-if="isAdmin && showLegacyGatewayId" class="sys-row sys-row--admin">
        <div class="sys-row__head">
          <h4>Gateway ID (개별 변경) <span class="admin-tag">legacy</span></h4>
          <RemoteConfigStatusBadge :status="states.gateway_id_update.status" />
        </div>
        <div class="sys-row__form">
          <span class="current">현재: <code>{{ gateway.gatewayId }}</code></span>
          <input v-model="form.newGatewayId" type="text" placeholder="lgw-farm01" :disabled="isPending('gateway_id_update')" />
          <button class="btn btn--danger" :disabled="!canApplyGatewayId" @click="onApplyGatewayId">적용</button>
        </div>
        <p class="warning">
          ⚠ hostname과 별개로 gateway-id만 변경합니다. 일반적으로는 위의 "게이트웨이 이름" 통합 변경을 사용하세요.
        </p>
      </section>
      <button v-if="isAdmin && !showLegacyGatewayId" class="btn-link" @click="showLegacyGatewayId = true">
        고급: hostname과 gateway-id 분리 변경
      </button>

      <!-- Server IP -->
      <section v-if="isAdmin" class="sys-row sys-row--admin">
        <div class="sys-row__head">
          <h4>Server IP <span class="admin-tag">admin</span></h4>
          <RemoteConfigStatusBadge :status="states.server_ip_update.status" />
        </div>
        <div class="sys-row__form">
          <span class="current">현재: <code>{{ gateway.serverIp || '(미설정)' }}</code></span>
          <input v-model="form.serverIp" type="text" placeholder="175.206.245.234" :disabled="isPending('server_ip_update')" />
          <button class="btn btn--danger" :disabled="!canApplyServerIp" @click="onApplyServerIp">적용</button>
        </div>
        <div class="sys-row__form">
          <input
            v-model="form.serverBootstrapToken"
            type="password"
            autocomplete="off"
            placeholder="새 서버 BOOTSTRAP_TOKEN (다른 서버 전환 시 필수)"
            :disabled="isPending('server_ip_update')"
          />
        </div>
        <p class="warning">
          ⚠ MQTT 서버 + Reverse Tunnel 서버 + Z2M / agent 모두 새 IP로 재연결됩니다.
          개발 ↔ 프로덕션처럼 <b>다른 서버</b>로 바꿀 땐 그 서버의 <b>BOOTSTRAP_TOKEN</b>을 입력해야
          게이트웨이가 새 서버에 자동 등록(lgw-default → 새 ID)됩니다. (같은 서버 IP만 바뀌면 토큰은 비워도 됩니다.)
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRemoteConfig } from '../../composables/useRemoteConfig'
import { useAuthStore } from '../../stores/auth.store'
import { useConfirm } from '../../composables/useConfirm'
import type { ConfigAction } from '../../api/config-deploy.api'
import RemoteConfigStatusBadge from './RemoteConfigStatusBadge.vue'

interface GatewayInfo {
  id: string
  gatewayId: string
  name: string
  status: string
  hostname?: string | null
  wifiSsid?: string | null
  serverIp?: string | null
}

const props = defineProps<{ gateway: GatewayInfo }>()
const auth = useAuthStore()
const { confirm } = useConfirm()
const isAdmin = computed(() => auth.user?.role === 'admin')

const expanded = ref(false)
const showLegacyGatewayId = ref(false)

const form = reactive({
  name: '',           // hostname + gateway-id 통합 (rpi-hostname-gateway-id-unify)
  ssid: '',
  psk: '',
  newGatewayId: '',
  serverIp: '',
  serverBootstrapToken: '', // 다른 서버 전환 시 새 서버 재등록용(선택)
})

const { states, applyWifi, applyGatewayId, applyServerIp, applyIdentity } =
  useRemoteConfig(props.gateway.gatewayId)

function isPending(action: ConfigAction) {
  return states.value[action].status === 'pending'
}

const HOSTNAME_RE = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/
const GATEWAY_ID_RE = /^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/
const IP_OR_FQDN_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/

const canApplyIdentity = computed(() =>
  !isPending('identity_update') &&
  HOSTNAME_RE.test(form.name.trim()) &&
  form.name.trim() !== props.gateway.gatewayId)
const canApplyWifi = computed(() =>
  !isPending('wifi_update') &&
  form.ssid.trim().length >= 1 && form.ssid.trim().length <= 32 &&
  form.psk.length >= 8 && form.psk.length <= 63)
const canApplyGatewayId = computed(() =>
  !isPending('gateway_id_update') && GATEWAY_ID_RE.test(form.newGatewayId.trim()))
const canApplyServerIp = computed(() =>
  !isPending('server_ip_update') && IP_OR_FQDN_RE.test(form.serverIp.trim()))

async function onApplyIdentity() {
  if (!await confirm({
    title: '게이트웨이 이름 변경',
    message: `게이트웨이 이름을 "${form.name}" 으로 변경합니다.\n\n동시 갱신 대상:\n- hostname\n- gateway-id (MQTT topic / Z2M base_topic)\n- DB의 모든 cascade 테이블\n- 모든 agent 환경변수`,
    confirmText: '변경',
  })) return
  await applyIdentity(form.name.trim())
}

async function onApplyWifi() {
  if (!await confirm({
    title: 'Wi-Fi 변경',
    message:
      '본사에서 농장 Wi-Fi로 변경하면 본사 Wi-Fi 인터넷이 끊깁니다. 이것은 정상이며 Pi를 농장에 설치하면 자동 연결됩니다. 비상시 LAN 직결 → 192.168.0.100',
    confirmText: '적용',
  })) return
  await applyWifi(form.ssid.trim(), form.psk)
}

async function onApplyGatewayId() {
  if (!await confirm({
    title: 'Gateway ID 변경 (위험)',
    message: `Gateway ID를 "${form.newGatewayId}" 로 변경합니다. DB의 모든 연관 데이터가 cascade 갱신됩니다.`,
    confirmText: '변경',
  })) return
  await applyGatewayId(form.newGatewayId.trim())
}

async function onApplyServerIp() {
  if (!await confirm({
    title: 'Server IP 변경 (위험)',
    message: `MQTT/Tunnel 서버를 "${form.serverIp}" 로 변경합니다. Pi의 모든 서비스가 새 IP로 재연결됩니다.`,
    confirmText: '변경',
  })) return
  await applyServerIp(form.serverIp.trim(), form.serverBootstrapToken.trim() || undefined)
  form.serverBootstrapToken = ''
}
</script>

<style scoped>
.sys-card {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  margin-bottom: 12px;
  background: var(--color-bg-card, #fff);
}
.sys-card__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; cursor: pointer; user-select: none;
  border-bottom: 1px solid transparent;
}
.sys-card:not(.sys-card--collapsed) .sys-card__header { border-bottom-color: var(--color-border, #e2e8f0); }
.sys-card__title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sys-card__name { color: var(--color-text-secondary, #64748b); font-size: 13px; }
.sys-card__status { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
.sys-card__status.status-online   { background: #c6f6d5; color: #22543d; }
.sys-card__status.status-offline  { background: #fed7d7; color: #742a2a; }
.sys-card__toggle {
  background: transparent; border: none; cursor: pointer;
  color: var(--color-text-secondary, #64748b); font-size: 13px;
}
.sys-card__body { padding: 12px 16px 16px; }

.sys-row { padding: 10px 0; border-top: 1px dashed var(--color-border, #e2e8f0); }
.sys-row:first-child { border-top: none; }
.sys-row--admin { background: rgba(254, 215, 215, 0.15); margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
.sys-row__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.sys-row__head h4 { margin: 0; font-size: 14px; }
.admin-tag { color: #c53030; font-size: 10px; font-weight: 700; margin-left: 6px; }
.sys-row__form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sys-row__form--wifi input[type="text"] { min-width: 160px; }
.sys-row__form input {
  padding: 6px 8px; border: 1px solid var(--color-border, #cbd5e0);
  border-radius: 4px; min-width: 140px;
}
.current { color: var(--color-text-secondary, #64748b); font-size: 13px; }
.current code { background: var(--color-bg-code, #edf2f7); padding: 1px 6px; border-radius: 3px; }
.btn {
  padding: 6px 14px; background: #2b6cb0; color: #fff; border: none;
  border-radius: 4px; cursor: pointer; font-size: 13px;
}
.btn:disabled { background: var(--color-disabled, #cbd5e0); cursor: not-allowed; }
.btn--danger { background: #c53030; }
.btn--danger:disabled { background: var(--color-disabled, #cbd5e0); }
.warning { color: #b7791f; font-size: 12px; margin: 6px 0 0; }
.warning code { background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 2px; }
.detail { font-size: 12px; color: var(--color-text-secondary, #64748b); margin: 6px 0 0; }
.detail-info { font-size: 12px; color: var(--color-text-secondary, #64748b); margin: 6px 0 0; font-style: italic; }
.sub-label { font-size: 11px; color: var(--color-text-secondary, #64748b); font-weight: 400; margin-left: 4px; }
.btn-link {
  background: transparent; border: none; color: var(--color-text-secondary, #64748b);
  cursor: pointer; font-size: 12px; padding: 6px 0; margin-top: 4px;
  text-decoration: underline;
}
.btn-link:hover { color: #2b6cb0; }
</style>
