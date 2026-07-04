<template>
  <div class="bulk-overlay" @click.self="$emit('close')">
    <div class="bulk-panel" :class="{ 'is-executing': executing }">
      <!-- 드래그 그립 (모바일) -->
      <div class="bulk-grip" aria-hidden="true"></div>

      <div class="bulk-header">
        <div class="bulk-title">
          <span class="bulk-bolt">⚡</span>
          <h3>일괄 제어</h3>
        </div>
        <button class="bulk-close" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <!-- ── STEP 1: 범위 선택 ── -->
      <div class="bulk-section">
        <div class="scope-head">
          <span class="scope-label">대상 구역</span>
          <span class="scope-summary">{{ scopeSummary }}</span>
        </div>
        <div class="scope-tabs">
          <button
            class="scope-tab"
            :class="{ active: scopeMode === 'all' }"
            @click="scopeMode = 'all'"
          >전체 구역</button>
          <button
            class="scope-tab"
            :class="{ active: scopeMode === 'custom' }"
            @click="scopeMode = 'custom'"
          >구역 선택</button>
        </div>
        <div v-if="scopeMode === 'custom'" class="scope-list">
          <label v-for="g in eligibleGroups" :key="g.id" class="scope-item">
            <input type="checkbox" :value="g.id" v-model="selectedIds" />
            <span class="scope-name">{{ g.name }}</span>
            <span class="scope-count">팬 {{ fansOf(g).length }} · 개폐기 {{ openerPairsOf(g).length }}</span>
          </label>
          <p v-if="eligibleGroups.length === 0" class="scope-empty">제어 가능한 장비가 있는 구역이 없습니다.</p>
        </div>
      </div>

      <!-- ── STEP 2: 장비 액션 ── -->
      <div class="bulk-section actions">
        <!-- 유동팬 -->
        <div class="device-block">
          <div class="device-block-head">
            <EquipmentIcon type="fan" :active="fanRunning > 0" :size="18" />
            <div class="device-block-info">
              <span class="device-block-name">유동팬</span>
              <span class="device-block-meta">
                선택 {{ fanTotal }}대<template v-if="fanTotal > 0"> · <b class="on">{{ fanRunning }} 가동중</b></template>
              </span>
            </div>
          </div>
          <div class="device-block-btns">
            <button class="act-btn" :disabled="fanTotal === 0 || executing" @click="openConfirm('fan', 'off')">전체 끄기</button>
            <button class="act-btn on" :disabled="fanTotal === 0 || executing" @click="openConfirm('fan', 'on')">전체 켜기</button>
          </div>
        </div>

        <!-- 개폐기 -->
        <div class="device-block">
          <div class="device-block-head">
            <EquipmentIcon type="opener_open" :active="openerOpen > 0" :size="18" />
            <div class="device-block-info">
              <span class="device-block-name">개폐기</span>
              <span class="device-block-meta">
                선택 {{ openerTotal }}대<template v-if="openerOpen > 0"> · <b class="open">열림 {{ openerOpen }}</b></template>
              </span>
            </div>
          </div>
          <div class="device-block-btns">
            <button class="act-btn" :disabled="openerTotal === 0 || executing" @click="openConfirm('opener', 'close')">전체 닫기</button>
            <button class="act-btn open" :disabled="openerTotal === 0 || executing" @click="openConfirm('opener', 'open')">전체 열기</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── STEP 3: 확인 모달 ── -->
    <div v-if="confirm" class="confirm-overlay" @click.self="!executing && (confirm = null)">
      <div class="confirm-box" :style="{ '--act': confirm.accent }">
        <div class="confirm-icon"><EquipmentIcon :type="confirm.iconType" :active="true" :size="22" /></div>
        <h4 class="confirm-title">{{ confirm.kindLabel }} 전체 {{ confirm.verb }}</h4>
        <p class="confirm-sub">
          선택한 구역의 {{ confirm.kindLabel }} <b>{{ confirm.count }}대</b>를 모두 {{ confirm.sentence }}
        </p>

        <div class="confirm-scope">
          <div class="confirm-scope-head">✓ 대상 구역 · {{ confirm.zones.length }}곳</div>
          <div class="confirm-chips">
            <span v-for="z in confirm.zones" :key="z.groupName" class="confirm-chip">{{ z.groupName }}</span>
          </div>
        </div>

        <div class="confirm-rows">
          <div v-for="z in confirm.zones" :key="z.groupName" class="confirm-row">
            <span class="cr-dot" :style="{ background: confirm.accent }"></span>
            <span class="cr-name">{{ z.groupName }} · {{ confirm.kindLabel }} {{ z.count }}대</span>
            <span class="cr-change">{{ z.from }} <span class="cr-arrow">→</span> {{ confirm.verb }}</span>
          </div>
        </div>

        <div class="confirm-btns">
          <button class="cf-cancel" :disabled="executing" @click="confirm = null">취소</button>
          <button class="cf-run" :disabled="executing" @click="execute">
            <span v-if="executing" class="cf-spin"></span>
            {{ executing ? `실행 중… (${execDone}/${confirm.count})` : `${confirm.count}대 ${confirm.verb}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDeviceStore } from '../../stores/device.store'
import { useNotificationStore } from '../../stores/notification.store'
import type { Device } from '../../types/device.types'
import type { HouseGroup } from '../../types/group.types'
import EquipmentIcon from '../common/EquipmentIcon.vue'

const props = defineProps<{ groups: HouseGroup[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const deviceStore = useDeviceStore()
const notify = useNotificationStore()

const ACCENT_FAN = '#2e7d32'
const ACCENT_OPENER = '#ef6c00'

// 라이브 상태 병합 (online/switchState 는 store 가 실시간 유지)
function live(d: Device): Device {
  const s = deviceStore.devices.find(x => x.id === d.id)
  return s ? { ...d, online: s.online, switchState: s.switchState } : d
}

// 구역 내 유동팬
function fansOf(g: HouseGroup): Device[] {
  return (g.devices || [])
    .filter(d => d.deviceType === 'actuator' && d.equipmentType === 'fan')
    .map(live)
}

interface OpenerPair { open: Device; close: Device }
// 구역 내 개폐기(열림/닫힘 페어)
function openerPairsOf(g: HouseGroup): OpenerPair[] {
  const devs = (g.devices || [])
  const opens = devs.filter(d => d.equipmentType === 'opener_open')
  const pairs: OpenerPair[] = []
  for (const open of opens) {
    const close = devs.find(d =>
      d.equipmentType === 'opener_close' &&
      (d.pairedDeviceId === open.id || open.pairedDeviceId === d.id ||
        (open.openerGroupName && d.openerGroupName === open.openerGroupName)),
    )
    if (close) pairs.push({ open: live(open), close: live(close) })
  }
  return pairs
}

// 장비가 하나라도 있는 구역만 범위 후보
const eligibleGroups = computed(() =>
  props.groups.filter(g => fansOf(g).length > 0 || openerPairsOf(g).length > 0),
)

const scopeMode = ref<'all' | 'custom'>('all')
const selectedIds = ref<string[]>([])

const scopeGroups = computed(() => {
  if (scopeMode.value === 'all') return eligibleGroups.value
  const set = new Set(selectedIds.value)
  return eligibleGroups.value.filter(g => set.has(g.id))
})

const scopeSummary = computed(() => {
  const gs = scopeGroups.value
  if (scopeMode.value === 'all') return `전체 ${gs.length}곳`
  if (gs.length === 0) return '구역을 선택하세요'
  if (gs.length === 1) return gs[0].name
  return `${gs[0].name} 외 ${gs.length - 1}`
})

// 집계
const scopeFans = computed(() => scopeGroups.value.flatMap(fansOf))
const scopeOpeners = computed(() => scopeGroups.value.flatMap(openerPairsOf))
const fanTotal = computed(() => scopeFans.value.length)
const fanRunning = computed(() => scopeFans.value.filter(f => f.switchState === true).length)
const openerTotal = computed(() => scopeOpeners.value.length)
const openerOpen = computed(() => scopeOpeners.value.filter(p => p.open.switchState === true).length)

// ── 확인 모달 ──
interface ConfirmItem { id: string; value: boolean; name: string }
// 구역별로 묶음 — 실행 시 구역 내는 순차(같은 회로 돌입전류 보호), 구역 간은 병렬.
interface ConfirmZone { groupName: string; count: number; from: string; items: ConfirmItem[] }
interface ConfirmState {
  kind: 'fan' | 'opener'
  action: 'on' | 'off' | 'open' | 'close'
  kindLabel: string
  verb: string
  sentence: string
  accent: string
  iconType: string
  count: number
  zones: ConfirmZone[]
}
const confirm = ref<ConfirmState | null>(null)
const executing = ref(false)
const execDone = ref(0)

function openConfirm(kind: 'fan' | 'opener', action: 'on' | 'off' | 'open' | 'close') {
  const zones: ConfirmZone[] = []
  if (kind === 'fan') {
    const value = action === 'on'
    for (const g of scopeGroups.value) {
      const fans = fansOf(g)
      if (fans.length === 0) continue
      const running = fans.filter(f => f.switchState === true).length
      zones.push({
        groupName: g.name, count: fans.length, from: `${running}대 가동`,
        items: fans.map(f => ({ id: f.id, value, name: f.name })),
      })
    }
    confirm.value = {
      kind, action, kindLabel: '유동팬', verb: action === 'on' ? '켜기' : '끄기',
      sentence: action === 'on' ? '켭니다.' : '끕니다.',
      accent: ACCENT_FAN, iconType: 'fan',
      count: zones.reduce((n, z) => n + z.items.length, 0), zones,
    }
  } else {
    for (const g of scopeGroups.value) {
      const pairs = openerPairsOf(g)
      if (pairs.length === 0) continue
      const openCnt = pairs.filter(p => p.open.switchState === true).length
      const from = openCnt === 0 ? '닫힘' : openCnt === pairs.length ? '열림' : '부분'
      zones.push({
        groupName: g.name, count: pairs.length, from,
        // 열기 → 열림 릴레이 ON, 닫기 → 닫힘 릴레이 ON. 반대편 인터록은 백엔드가 처리.
        items: pairs.map(p => {
          const t = action === 'open' ? p.open : p.close
          return { id: t.id, value: true, name: t.name }
        }),
      })
    }
    confirm.value = {
      kind, action, kindLabel: '개폐기', verb: action === 'open' ? '열기' : '닫기',
      sentence: action === 'open' ? '엽니다.' : '닫습니다.',
      accent: ACCENT_OPENER, iconType: 'opener_open',
      count: zones.reduce((n, z) => n + z.items.length, 0), zones,
    }
  }
}

// 시차 기동(staggered start) — 모터 돌입전류 합산/차단기 트립/전원 스파이크 방지.
// 개폐기(양방향 모터 구동)·환풍기 켜기는 지연을 주고, 끄기는 돌입이 없어 지연 없음.
function staggerMs(kind: 'fan' | 'opener', action: 'on' | 'off' | 'open' | 'close'): number {
  if (kind === 'opener') return 1000  // 열기/닫기 모두 모터 구동 + 백엔드 인터록(OFF→1초→ON) 여유
  return action === 'on' ? 350 : 0    // 팬: 켜기만 돌입전류, 끄기는 즉시
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function execute() {
  if (!confirm.value || executing.value) return
  executing.value = true
  const c = confirm.value
  const gap = staggerMs(c.kind, c.action)
  let ok = 0
  const failed: string[] = []
  execDone.value = 0
  // 구역 간 병렬, 구역 내 순차 시차 — 전기시설이 구역별로 별도이므로 돌입전류는 같은 구역에서만
  // 몰림. 서로 다른 구역은 동시에 진행 → 전체 구역 100대라도 (가장 많은 구역 대수 × 시차)로 수렴.
  // 각 호출은 단일 제어와 동일한 controlDevice 경로(인터록/타이머는 백엔드 처리).
  const perZone = await Promise.all(c.zones.map(async (zone) => {
    let zok = 0
    const zfail: string[] = []
    for (let i = 0; i < zone.items.length; i++) {
      if (i > 0 && gap > 0) await sleep(gap)
      const t = zone.items[i]
      try {
        const res: any = await deviceStore.controlDevice(t.id, [{ code: 'switch_1', value: t.value }])
        if (res && res.success === false) { zfail.push(t.name) } else { zok++ }
      } catch {
        zfail.push(t.name)
      }
      execDone.value++   // JS 단일 스레드 — await 사이 증가라 경쟁 없음
    }
    return { zok, zfail }
  }))
  for (const r of perZone) { ok += r.zok; failed.push(...r.zfail) }
  executing.value = false

  const label = `${c.kindLabel} 전체 ${c.verb}`
  if (failed.length === 0) {
    notify.success('일괄 제어 완료', `${label} — ${ok}대 성공`)
  } else if (ok === 0) {
    notify.error('일괄 제어 실패', `${label} — ${failed.length}대 모두 실패`)
  } else {
    notify.warning('일부 실패', `${label} — ${ok}대 성공 / ${failed.length}대 실패`)
  }

  // 최신 상태 반영
  try { await deviceStore.fetchDevices() } catch { /* 실시간 소켓으로도 갱신됨 */ }
  confirm.value = null
  emit('close')
}
</script>

<style scoped>
.bulk-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: var(--overlay, rgba(0, 0, 0, 0.45));
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.bulk-panel {
  width: 100%; max-width: 440px;
  background: var(--bg-card); border: 1px solid var(--border-card);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  display: flex; flex-direction: column; gap: 4px;
  padding: 18px 20px 20px; max-height: 90vh; overflow-y: auto;
}
.bulk-grip { display: none; }

.bulk-header { display: flex; align-items: center; justify-content: space-between; }
.bulk-title { display: flex; align-items: center; gap: 8px; }
.bulk-bolt { font-size: calc(20px * var(--content-scale, 1)); }
.bulk-title h3 { margin: 0; font-size: calc(18px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.bulk-close {
  background: none; border: none; cursor: pointer; font-size: 18px;
  color: var(--text-muted); width: 32px; height: 32px; border-radius: 8px;
}
.bulk-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.bulk-section { padding: 14px 0; border-top: 1px solid var(--border-light); }
.bulk-section:first-of-type { border-top: none; }

.scope-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.scope-label { font-size: calc(14px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.scope-summary { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); font-weight: 600; }
.scope-tabs { display: flex; gap: 8px; }
.scope-tab {
  flex: 1; padding: 9px 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--border-input); background: var(--bg-card);
  color: var(--text-secondary); font-weight: 600; font-size: calc(13px * var(--content-scale, 1));
}
.scope-tab.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.scope-list {
  margin-top: 10px; display: flex; flex-direction: column; gap: 4px;
  max-height: 190px; overflow-y: auto;
}
.scope-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 10px;
  border-radius: 9px; cursor: pointer; min-height: 44px;
}
.scope-item:hover { background: var(--bg-hover); }
.scope-item input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); }
.scope-name { flex: 1; min-width: 0; font-weight: 600; color: var(--text-primary); font-size: calc(14px * var(--content-scale, 1)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope-count { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); flex-shrink: 0; }
.scope-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 12px; }

.actions { display: flex; flex-direction: column; gap: 12px; }
.device-block { background: var(--bg-secondary, var(--bg-hover)); border: 1px solid var(--border-light); border-radius: 12px; padding: 12px 14px; }
.device-block-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.device-block-info { display: flex; flex-direction: column; min-width: 0; }
.device-block-name { font-weight: 700; color: var(--text-primary); font-size: calc(15px * var(--content-scale, 1)); }
.device-block-meta { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); }
.device-block-meta b.on { color: #2e7d32; }
.device-block-meta b.open { color: #ef6c00; }
.device-block-btns { display: flex; gap: 8px; }
.act-btn {
  flex: 1; min-height: 44px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--border-input); background: var(--bg-card);
  color: var(--text-secondary); font-weight: 700; font-size: calc(14px * var(--content-scale, 1));
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.act-btn:hover:not(:disabled) { background: var(--bg-hover); }
.act-btn.on { border-color: #2e7d32; color: #2e7d32; }
.act-btn.on:hover:not(:disabled) { background: rgba(46, 125, 50, 0.08); }
.act-btn.open { border-color: #ef6c00; color: #ef6c00; }
.act-btn.open:hover:not(:disabled) { background: rgba(239, 108, 0, 0.08); }
.act-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── 확인 모달 ── */
.confirm-overlay {
  position: fixed; inset: 0; z-index: 1300;
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.confirm-box {
  width: 100%; max-width: 400px; background: var(--bg-card);
  border: 1px solid var(--border-card); border-radius: 16px;
  padding: 24px 22px 20px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.24);
  text-align: center;
}
.confirm-icon {
  width: 52px; height: 52px; border-radius: 14px; margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--act) 15%, transparent);
}
.confirm-title { margin: 0 0 6px; font-size: calc(18px * var(--content-scale, 1)); font-weight: 800; color: var(--text-primary); }
.confirm-sub { margin: 0 0 16px; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); }
.confirm-sub b { color: var(--act); }
.confirm-scope {
  text-align: left; border: 1px solid color-mix(in srgb, var(--act) 30%, var(--border-light));
  background: color-mix(in srgb, var(--act) 6%, transparent);
  border-radius: 10px; padding: 10px 12px; margin-bottom: 12px;
}
.confirm-scope-head { font-size: 12px; font-weight: 800; color: var(--act); margin-bottom: 6px; }
.confirm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.confirm-chip { font-size: 12px; font-weight: 600; background: var(--bg-card); border: 1px solid var(--border-input); border-radius: 6px; padding: 3px 9px; color: var(--text-secondary); }
.confirm-rows { text-align: left; display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.confirm-row { display: flex; align-items: center; gap: 8px; font-size: calc(13px * var(--content-scale, 1)); }
.cr-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.cr-name { flex: 1; min-width: 0; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-change { flex-shrink: 0; font-weight: 700; color: var(--act); }
.cr-arrow { color: var(--text-muted); }
.confirm-btns { display: flex; gap: 10px; }
.cf-cancel {
  flex: 1; min-height: 46px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--border-input); background: var(--bg-card);
  color: var(--text-secondary); font-weight: 700; font-size: calc(15px * var(--content-scale, 1));
}
.cf-cancel:hover:not(:disabled) { background: var(--bg-hover); }
.cf-run {
  flex: 2; min-height: 46px; border-radius: 10px; cursor: pointer; border: none;
  background: var(--act); color: #fff; font-weight: 800; font-size: calc(15px * var(--content-scale, 1));
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}
.cf-run:hover:not(:disabled) { filter: brightness(0.94); }
.cf-run:disabled, .cf-cancel:disabled { opacity: 0.6; cursor: not-allowed; }
.cf-spin { width: 15px; height: 15px; border: 2px solid rgba(255, 255, 255, 0.5); border-top-color: #fff; border-radius: 50%; animation: bc-spin 0.7s linear infinite; }
@keyframes bc-spin { to { transform: rotate(360deg); } }

/* ── 모바일: 바텀 시트 ── */
@media (max-width: 768px) {
  .bulk-overlay { align-items: flex-end; padding: 0; }
  .bulk-panel {
    max-width: 100%; border-radius: 18px 18px 0 0;
    padding-top: 8px; max-height: 88vh;
    animation: bc-slide-up 0.22s ease;
  }
  .bulk-grip { display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--border-input); margin: 4px auto 8px; }
  @keyframes bc-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
}
</style>
