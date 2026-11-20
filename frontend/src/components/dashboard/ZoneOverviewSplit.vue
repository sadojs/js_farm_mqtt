<template>
  <section v-if="zones.length" class="zo" aria-label="구역 현황">
    <nav class="zo-list" aria-label="구역">
      <span class="zo-cap">구역</span>
      <button
        v-for="z in zones" :key="z.id" type="button"
        class="zo-item" :class="{ sel: z.id === selectedId }"
        :aria-pressed="z.id === selectedId"
        @click="selectedId = z.id"
      >{{ z.name }}</button>
    </nav>

    <div v-if="zone" class="zo-detail">
      <div class="zo-head">
        <h3>{{ zone.name }} 현황</h3>
        <router-link to="/groups" class="zo-more">구역 관리 ›</router-link>
      </div>

      <div class="zo-big">
        <div class="zo-tile">
          <span class="zo-cap">내부 온도</span>
          <b>{{ fmt(env.internal_temp?.value, '℃') }}</b>
        </div>
        <div class="zo-tile">
          <span class="zo-cap">내부 습도</span>
          <b>{{ fmt(env.internal_humidity?.value, '%') }}</b>
        </div>
        <div v-for="op in openers" :key="op.id" class="zo-tile clickable" role="button" tabindex="0"
          @click="openStatus(op.id, op.name)" @keydown.enter="openStatus(op.id, op.name)">
          <span class="zo-cap">{{ op.name }}</span>
          <b>{{ op.state }}</b>
          <span class="zo-hint">눌러서 제어 현황</span>
        </div>
        <div v-for="d in others" :key="d.id" class="zo-tile clickable" role="button" tabindex="0"
          @click="openStatus(d.id, d.name)" @keydown.enter="openStatus(d.id, d.name)">
          <span class="zo-cap">{{ d.name }}</span>
          <b>{{ d.state }}</b>
          <span class="zo-hint">눌러서 제어 현황</span>
        </div>
      </div>

      <div class="zo-row">
        <div class="zo-box">
          <span class="zo-cap">환경 경보</span>
          <p v-if="!alerts" class="zo-muted">불러오는 중…</p>
          <p v-else-if="!alerts.saved" class="zo-muted">아직 설정하지 않았습니다. 구역 관리 → 구역 환경 설정에서 켤 수 있습니다.</p>
          <ul v-else class="zo-ul">
            <li v-for="i in alerts.items" :key="i.key" :class="{ off: !i.enabled }">
              {{ i.label }} {{ i.threshold }}{{ i.unit }} {{ i.dir === 'low' ? '이하' : '이상' }} · {{ i.minutes }}분
              <span>{{ i.enabled ? '켜짐' : '꺼짐' }}</span>
            </li>
          </ul>
        </div>
        <div class="zo-box">
          <span class="zo-cap">최근 알림</span>
          <p v-if="recent.length === 0" class="zo-muted">이 구역의 최근 알림이 없습니다.</p>
          <ul v-else class="zo-ul">
            <li v-for="n in recent" :key="n.id" :class="n.type">
              <b>{{ n.title }}</b>
              <span class="zo-muted">{{ n.message }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <ControlStatusModal :device-id="statusId" :device-name="statusName" @close="statusId = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useGroupStore } from '../../stores/group.store'
import { useDeviceStore } from '../../stores/device.store'
import { useNotificationStore } from '../../stores/notification.store'
import { envConfigApi, envAlertsApi, type ResolvedValue, type EnvAlertSettings } from '../../api/env-config.api'
import ControlStatusModal from '../devices/ControlStatusModal.vue'

/** 넓은 화면(1200px 이상) 대시보드 — 구역 목록 | 선택한 구역 현황 (검토 §7-10 ⑤) */

const groupStore = useGroupStore()
const deviceStore = useDeviceStore()
const notificationStore = useNotificationStore()

const zones = computed(() => groupStore.iotGroups)
const selectedId = ref<string | null>(null)
const zone = computed(() => zones.value.find(z => z.id === selectedId.value) ?? null)
const env = ref<Record<string, ResolvedValue>>({})
const alerts = ref<EnvAlertSettings | null>(null)
const statusId = ref<string | null>(null)
const statusName = ref('')

watch(zones, (zs) => {
  if (!zs.some(z => z.id === selectedId.value)) selectedId.value = zs[0]?.id ?? null
}, { immediate: true })

watch(selectedId, async (id) => {
  env.value = {}
  alerts.value = null
  if (!id) return
  const [r, a] = await Promise.all([
    envConfigApi.getResolved(id).then(x => x.data).catch(() => ({})),
    envAlertsApi.get(id).then(x => x.data).catch(() => null),
  ])
  if (selectedId.value !== id) return
  env.value = r as Record<string, ResolvedValue>
  alerts.value = a
}, { immediate: true })

const live = (id: string) => deviceStore.devices.find(d => d.id === id)

const openers = computed(() => {
  const devs = zone.value?.devices ?? []
  const seen = new Set<string>()
  const out: { id: string; name: string; state: string }[] = []
  for (const d of devs) {
    if (d.equipmentType !== 'opener_open' || seen.has(d.id)) continue
    seen.add(d.id)
    const close = devs.find(x => x.id === d.pairedDeviceId)
    const o = live(d.id)?.switchState ?? d.switchState
    const c = close ? (live(close.id)?.switchState ?? close.switchState) : false
    out.push({
      id: d.id,
      name: (d as any).openerGroupName || d.name,
      state: o ? '열림 동작 중' : c ? '닫힘 동작 중' : '멈춤',
    })
  }
  return out
})

const others = computed(() => (zone.value?.devices ?? [])
  .filter(d => d.equipmentType === 'fan' || d.equipmentType === 'irrigation')
  .map(d => {
    const l: any = live(d.id) ?? d
    const on = d.equipmentType === 'irrigation'
      ? Object.values(l.switchStates ?? {}).some(Boolean)
      : !!l.switchState
    return { id: d.id, name: d.name, state: d.equipmentType === 'irrigation' ? (on ? '관수 중' : '관수 대기') : (on ? '가동 중' : '정지') }
  }))

const recent = computed(() => {
  const name = zone.value?.name
  if (!name) return []
  return notificationStore.centerItems
    .filter(n => n.title.includes(name) || n.message.includes(name))
    .slice(0, 3)
})

onMounted(() => {
  if (groupStore.groups.length === 0) groupStore.fetchGroups().catch(() => undefined)
})

function fmt(v: number | null | undefined, unit: string) {
  return v == null ? '-' : `${Math.round(Number(v) * 10) / 10}${unit}`
}
function openStatus(id: string, name: string) {
  statusName.value = name
  statusId.value = id
}
</script>

<style scoped>
.zo {
  display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 0;
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 14px;
  box-shadow: var(--shadow-card); overflow: hidden; margin-bottom: 20px;
}
.zo-list { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-right: 1px solid var(--border-light); }
.zo-cap { font-size: calc(12px * var(--content-scale, 1)); font-weight: 700; color: var(--text-muted); }
.zo-item {
  text-align: left; padding: 9px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border-light); background: var(--bg-card); color: var(--text-primary);
  font-size: calc(14px * var(--content-scale, 1));
}
.zo-item.sel { background: var(--accent-bg); border-color: var(--accent); font-weight: 700; }
.zo-detail { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.zo-head { display: flex; align-items: baseline; gap: 10px; }
.zo-head h3 { margin: 0; flex: 1; font-size: calc(17px * var(--content-scale, 1)); color: var(--text-primary); }
.zo-more { font-size: calc(13px * var(--content-scale, 1)); color: var(--accent); text-decoration: none; font-weight: 600; }
.zo-big { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.zo-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--bg-hover); min-width: 0; }
.zo-tile b { font-size: calc(17px * var(--content-scale, 1)); color: var(--text-primary); }
.zo-tile.clickable { cursor: pointer; border: 1px solid transparent; }
.zo-tile.clickable:hover, .zo-tile.clickable:focus-visible { border-color: var(--accent); outline: none; }
.zo-hint { font-size: calc(11px * var(--content-scale, 1)); color: var(--text-muted); }
.zo-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.zo-box { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px; background: var(--bg-hover); min-width: 0; }
.zo-muted { margin: 0; color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); line-height: 1.5; }
.zo-ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-primary); }
.zo-ul li { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.zo-ul li.off { color: var(--text-muted); }
.zo-ul li.error b { color: var(--danger); }
.zo-ul li.warning b { color: var(--warning); }
</style>
