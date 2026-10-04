<template>
  <div class="c-body">
    <div class="c-head">
      <div>
        <h1 class="c-h1">플랫폼 개요</h1>
        <p class="c-sub">전체 농장 · 사용자 · 게이트웨이 상태를 한 화면에서 확인합니다</p>
      </div>
      <div class="c-actions">
        <button class="c-btn" type="button" :disabled="loading" @click="refresh"><CIcon name="refresh" :size="14" />{{ loading ? '불러오는 중…' : '새로고침' }}</button>
        <router-link class="c-btn c-btn-pri" to="/users?new=1"><CIcon name="plus" :size="14" />사용자 추가</router-link>
      </div>
    </div>

    <div class="c-kpis">
      <div class="c-card c-kpi"><div class="c-l">농장</div><div class="c-v">{{ platform.counts.farms }}</div><div class="c-s">농장 관리자 계정 기준</div></div>
      <div class="c-card c-kpi"><div class="c-l">사용자</div><div class="c-v">{{ platform.counts.users }}</div>
        <div class="c-s">관리자 {{ platform.counts.admins }} · 농장관리자 {{ platform.counts.farmAdmins }} · 농장사용자 {{ platform.counts.farmUsers }}</div></div>
      <div class="c-card c-kpi"><div class="c-l"><span class="c-led" :class="gwOnline === platform.gateways.length ? 'c-led-ok' : 'c-led-warn'" />게이트웨이 온라인</div>
        <div class="c-v">{{ gwOnline }}<small> / {{ platform.gateways.length }}</small></div><div class="c-s">점검 필요 {{ gwWarn }}</div></div>
      <div class="c-card c-kpi"><div class="c-l"><span class="c-led" :class="sensorsOffline.length ? 'c-led-warn' : 'c-led-ok'" />측정기 온라인</div>
        <div class="c-v">{{ sensors.length - sensorsOffline.length }}<small> / {{ sensors.length }}</small></div>
        <div class="c-s">오프라인 {{ sensorsOffline.length }}<template v-if="sensorsOffline.length"> · {{ sensorsOffline.slice(0, 2).map((d) => d.name).join(', ') }}</template></div></div>
      <div class="c-card c-kpi"><div class="c-l">페일오버</div>
        <div class="c-v" style="font-size:20px;padding:4px 0">{{ failoverHeadline }}</div><div class="c-s">{{ failoverSub }}</div></div>
    </div>

    <div class="c-row-wrap">
      <div class="c-card" style="flex:2 1 560px">
        <div class="c-card-h">농장 현황 <router-link to="/farms">전체 보기 →</router-link></div>
        <div class="c-tbl-wrap">
          <table class="c-tbl">
            <thead><tr><th>농장</th><th>관리자 계정</th><th>구역</th><th>게이트웨이</th><th>구성원</th><th>상태</th><th /></tr></thead>
            <tbody>
              <tr v-for="f in farmRows" :key="f.id">
                <td><b>{{ farmLabel(f) }}</b></td>
                <td>{{ f.name }} <span class="c-mono c-muted">@{{ f.username }}</span></td>
                <td class="c-mono">{{ f.zones }}</td>
                <td>
                  <span v-for="gw in f.gateways" :key="gw.id" class="c-pill" :class="gwOk(gw) ? 'c-p-ok' : 'c-p-warn'" style="margin-right:4px">
                    <span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />{{ gw.name }}</span>
                  <span v-if="!f.gateways.length" class="c-muted">미할당</span>
                </td>
                <td class="c-mono">{{ f.members }}</td>
                <td><span class="c-pill" :class="f.ready ? 'c-p-ok' : 'c-p-warn'">{{ f.ready ? '운영 중' : '설정 필요' }}</span></td>
                <td class="c-r">
                  <router-link v-if="f.ready" class="c-btn c-btn-sm" :to="`/farm/${f.id}/dashboard`">농장 보기</router-link>
                  <router-link v-else class="c-btn c-btn-sm" :to="`/farms?select=${f.id}`">설정</router-link>
                </td>
              </tr>
              <tr v-if="!farmRows.length"><td colspan="7" class="c-empty">{{ loading ? '불러오는 중…' : '등록된 농장이 없습니다' }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="c-card" style="flex:1 1 300px">
        <div class="c-card-h">주의 필요 <small>{{ attention.length }}건</small></div>
        <div v-for="(a, i) in attention" :key="i" class="c-alert-i">
          <div class="c-ico" :style="a.tone === 'bad' ? 'background:var(--c-bad-bg);color:var(--c-bad-fg)' : a.tone === 'warn' ? 'background:var(--c-warn-bg);color:var(--c-warn-fg)' : 'background:var(--c-off-bg);color:var(--c-off-fg)'">
            <CIcon :name="a.icon" :size="14" />
          </div>
          <div><div class="c-t">{{ a.title }}</div><div class="c-d">{{ a.desc }}</div></div>
        </div>
        <div v-if="!attention.length" class="c-empty">{{ loading ? '확인 중…' : '주의가 필요한 항목이 없습니다' }}</div>
      </div>
    </div>

    <div class="c-card">
      <div class="c-card-h">게이트웨이 상태 <router-link to="/gateways">게이트웨이 관리 →</router-link></div>
      <div class="c-tbl-wrap">
        <table class="c-tbl">
          <thead><tr><th>게이트웨이</th><th>농장</th><th>연결 구역</th><th>Agent</th><th>Zigbee</th><th>SSH</th><th>페일오버</th><th>마지막 하트비트</th><th /></tr></thead>
          <tbody>
            <tr v-for="gw in platform.gateways" :key="gw.id">
              <td><b>{{ gw.name }}</b> <span class="c-mono c-muted">{{ gw.gatewayId }}</span></td>
              <td>{{ platform.ownerLabel(gw.userId) }}</td>
              <td>{{ gw.groupName || '—' }}</td>
              <td><span class="c-pill" :class="agentOnline(gw) ? 'c-p-ok' : 'c-p-bad'"><span class="c-led" :class="agentOnline(gw) ? 'c-led-ok' : 'c-led-warn'" />{{ agentOnline(gw) ? '온라인' : '오프라인' }}</span></td>
              <td><span class="c-pill" :class="gw.zigbeeStatus === 'online' ? 'c-p-ok' : 'c-p-off'">{{ gw.zigbeeStatus === 'online' ? '연결' : '미연결' }}</span></td>
              <td class="c-mono">{{ tunnelConnected(gw) && gw.tunnelPort ? ':' + gw.tunnelPort : '끊김' }}</td>
              <td>
                <template v-if="failover.byGatewayId.value[gw.gatewayId]">
                  <span class="c-pill" :class="failover.byGatewayId.value[gw.gatewayId].mode === 'fallback' ? 'c-p-bad' : 'c-p-ok'">{{ failover.byGatewayId.value[gw.gatewayId].mode.toUpperCase() }} v{{ failover.byGatewayId.value[gw.gatewayId].version }}</span>
                  <span v-if="failover.byGatewayId.value[gw.gatewayId].sync !== 'synced'" class="c-pill c-p-warn" style="margin-left:4px">{{ failover.byGatewayId.value[gw.gatewayId].sync === 'syncing' ? '동기화 중' : '미동기화' }}</span>
                </template>
                <span v-else class="c-muted">—</span>
              </td>
              <td class="c-mono">{{ fmtDateTime(failover.byGatewayId.value[gw.gatewayId]?.lastHeartbeat || gw.lastSeen) }}</td>
              <td class="c-r">
                <div style="display:flex;gap:6px;justify-content:flex-end">
                  <router-link class="c-btn c-btn-sm" :to="`/gateways?select=${gw.id}&terminal=1`">터미널</router-link>
                  <router-link class="c-btn c-btn-sm" :to="`/gateways?select=${gw.id}`">상세</router-link>
                </div>
              </td>
            </tr>
            <tr v-if="!platform.gateways.length"><td colspan="9" class="c-empty">{{ loading ? '불러오는 중…' : '등록된 게이트웨이가 없습니다' }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import apiClient from '@/api/client'
import type { Device } from '@/types/device.types'
import CIcon from '@console/components/CIcon.vue'
import { usePlatformStore, farmLabel, agentOnline, tunnelConnected, gatewayOk as gwOk, gatewayIssue } from '@console/stores/platform.store'
import { useFailoverSummary, fmtDateTime } from '@console/composables/useFailoverSummary'
import { PLATFORM_REQUEST } from '@console/farm/farmContext'

const platform = usePlatformStore()
const failover = useFailoverSummary()
const devices = ref<Device[]>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    await platform.load(true)
    const [devRes] = await Promise.allSettled([apiClient.get<Device[]>('/devices', PLATFORM_REQUEST)])
    if (devRes.status === 'fulfilled') devices.value = devRes.value.data
    await failover.load(platform.gateways.map((g) => g.gatewayId))
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const gwOnline = computed(() => platform.gateways.filter(agentOnline).length)
const gwWarn = computed(() => platform.gateways.filter((g) => !gwOk(g)).length)
const sensors = computed(() => devices.value.filter((d) => d.deviceType === 'sensor'))
const sensorsOffline = computed(() => sensors.value.filter((d) => !d.online))

const failoverHeadline = computed(() => {
  const list = Object.values(failover.byGatewayId.value)
  if (!list.length) return '—'
  if (list.some((s) => s.mode === 'fallback')) return 'FALLBACK'
  return list.every((s) => s.mode === 'online') ? 'ONLINE' : 'UNKNOWN'
})
const failoverSub = computed(() => {
  const list = Object.values(failover.byGatewayId.value)
  if (!list.length) return '설정된 게이트웨이 없음'
  const syncing = list.filter((s) => s.sync !== 'synced').length
  const fb = list.filter((s) => s.mode === 'fallback').length
  return [fb ? `폴백 동작 ${fb}대` : '', syncing ? `동기화 진행 ${syncing}건` : '모두 동기화됨'].filter(Boolean).join(' · ')
})

const farmRows = computed(() => platform.farms.map((f) => {
  const zones = platform.groupsOfFarm(f.id).length
  const gateways = platform.gatewaysOfFarm(f.id)
  return { ...f, zones, gateways, members: platform.membersOfFarm(f.id).length, ready: zones > 0 && gateways.length > 0 }
}))

const attention = computed(() => {
  const out: Array<{ tone: 'bad' | 'warn' | 'off'; icon: string; title: string; desc: string }> = []
  for (const d of sensorsOffline.value) {
    out.push({ tone: 'bad', icon: 'wifioff', title: `${d.name} 오프라인`, desc: `${platform.ownerLabel(d.userId)} · 측정기` })
  }
  for (const gw of platform.gateways) {
    const issue = gatewayIssue(gw)
    if (issue) out.push({ tone: agentOnline(gw) ? 'warn' : 'bad', icon: 'gateway', title: `${gw.name} 점검 필요`, desc: issue })
    const fo = failover.byGatewayId.value[gw.gatewayId]
    if (fo?.mode === 'fallback') out.push({ tone: 'bad', icon: 'warn', title: `${gw.name} 폴백 모드 동작 중`, desc: '서버 연결 단절로 게이트웨이 자체 제어 중' })
    else if (fo && fo.sync !== 'synced') out.push({ tone: 'warn', icon: 'refresh', title: '페일오버 설정 동기화 중', desc: `${gw.name} · RPi v${fo.appliedVersion ?? '—'} → 서버 v${fo.version}` })
  }
  const notReady = farmRows.value.filter((f) => !f.ready)
  if (notReady.length) out.push({ tone: 'off', icon: 'info', title: `구역 · 게이트웨이 미할당 농장 ${notReady.length}곳`, desc: notReady.map((f) => farmLabel(f)).join(', ') })
  return out
})
</script>
