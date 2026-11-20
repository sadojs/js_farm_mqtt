<template>
  <aside class="rd-pane" aria-label="선택한 규칙">
    <template v-if="rule">
      <div class="rd-head">
        <h3 class="rd-name">{{ rule.name }}</h3>
        <span class="rd-pill" :class="{ on: rule.enabled }">{{ rule.enabled ? '켜짐' : '꺼짐' }}</span>
      </div>
      <p class="rd-target">{{ targetText }}</p>

      <div class="rd-box">
        <span class="rd-cap">조건 → 동작</span>
        <p class="rd-text">{{ conditionText }} <b>→ {{ actionText }}</b></p>
      </div>

      <div class="rd-box">
        <span class="rd-cap">지금 제어 현황</span>
        <p v-if="!firstDeviceId" class="rd-muted">대상 장치가 없습니다.</p>
        <p v-else-if="statusLoading && !status" class="rd-muted">불러오는 중…</p>
        <template v-else-if="status">
          <p class="rd-text">
            <b>{{ status.winner ? `${status.winner.label}이(가) 제어 중` : '지금 제어 요청 없음' }}</b>
            <span v-if="status.winner" class="rd-muted"> · {{ status.winner.detail }}</span>
          </p>
          <p v-if="status.lock" class="rd-lock">🔒 비상 정지 중</p>
          <button class="rd-link" @click="showStatus = true">{{ status.deviceName }} 우선순위 자세히 ›</button>
        </template>
      </div>

      <div class="rd-box">
        <span class="rd-cap">최근 실행</span>
        <p v-if="logsLoading && logs.length === 0" class="rd-muted">불러오는 중…</p>
        <p v-else-if="logs.length === 0" class="rd-muted">아직 실행 기록이 없습니다.</p>
        <ul v-else class="rd-logs">
          <li v-for="l in logs" :key="l.id">
            <span :class="['rd-dot', l.success ? 'ok' : 'bad']" aria-hidden="true"></span>
            <span class="rd-time">{{ fmtTime(l.executedAt) }}</span>
            <span class="rd-muted">{{ logText(l) }}</span>
          </li>
        </ul>
      </div>

      <div class="rd-actions">
        <button class="rd-btn" @click="emit('copy', rule)">복사</button>
        <button class="rd-btn pri" @click="emit('edit', rule)">수정</button>
      </div>
    </template>
    <p v-else class="rd-empty">왼쪽 목록에서 규칙을 고르면 자세한 내용이 여기에 나옵니다.</p>

    <ControlStatusModal :device-id="showStatus ? firstDeviceId : null" @close="showStatus = false" @released="loadStatus" />
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AutomationRule, AutomationLog } from '../../types/automation.types'
import { automationApi, type ControlStatus } from '../../api/automation.api'
import ControlStatusModal from '../devices/ControlStatusModal.vue'

const props = defineProps<{
  rule: AutomationRule | null
  targetText: string
  conditionText: string
  actionText: string
}>()
const emit = defineEmits<{ edit: [rule: AutomationRule]; copy: [rule: AutomationRule] }>()

const status = ref<ControlStatus | null>(null)
const statusLoading = ref(false)
const logs = ref<AutomationLog[]>([])
const logsLoading = ref(false)
const showStatus = ref(false)

const firstDeviceId = computed<string | null>(() => {
  const a: any = props.rule?.actions
  return a?.targetDeviceIds?.[0] ?? a?.targetDeviceId ?? null
})

async function loadStatus() {
  if (!firstDeviceId.value) { status.value = null; return }
  statusLoading.value = true
  try {
    status.value = (await automationApi.getControlStatus(firstDeviceId.value)).data
  } catch { status.value = null } finally { statusLoading.value = false }
}

async function loadLogs() {
  if (!props.rule) { logs.value = []; return }
  logsLoading.value = true
  try {
    const { data } = await automationApi.getLogs({ ruleId: props.rule.id, limit: 3 })
    const arr = Array.isArray(data) ? data : ((data as any)?.data ?? [])
    logs.value = arr.slice(0, 3)
  } catch { logs.value = [] } finally { logsLoading.value = false }
}

watch(() => props.rule?.id, () => {
  status.value = null
  logs.value = []
  loadStatus()
  loadLogs()
}, { immediate: true })

function fmtTime(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function logText(l: AutomationLog) {
  if (!l.success) return l.errorMessage || '실패'
  const c = l.conditionsMet || {}
  if (c.deactivated) return '조건 해제 → 멈춤'
  if (c.type === 'force_execute') return '바로 실행'
  const names: string[] = l.actionsExecuted?.deviceNames || []
  return names.length ? `${names.join(', ')} 동작` : '실행'
}
</script>

<style scoped>
.rd-pane {
  position: sticky; top: 16px;
  display: flex; flex-direction: column; gap: 12px;
  padding: 18px; border-radius: 14px;
  background: var(--bg-card); border: 1px solid var(--border-card); box-shadow: var(--shadow-card);
  max-height: calc(100vh - 32px); overflow-y: auto;
}
.rd-head { display: flex; align-items: center; gap: 8px; }
.rd-name { margin: 0; flex: 1; min-width: 0; font-size: calc(17px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); word-break: break-word; }
.rd-pill { padding: 2px 10px; border-radius: 999px; font-size: calc(12px * var(--content-scale, 1)); font-weight: 700; background: var(--bg-hover); color: var(--text-muted); }
.rd-pill.on { background: var(--accent-bg); color: var(--accent); }
.rd-target { margin: -6px 0 0; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }
.rd-box { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; background: var(--bg-hover); }
.rd-cap { font-size: calc(12px * var(--content-scale, 1)); font-weight: 700; color: var(--text-muted); }
.rd-text { margin: 0; font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary); line-height: 1.5; }
.rd-muted { color: var(--text-muted); font-size: calc(13px * var(--content-scale, 1)); margin: 0; }
.rd-lock { margin: 0; color: var(--danger); font-weight: 600; font-size: calc(13px * var(--content-scale, 1)); }
.rd-link { align-self: flex-start; background: none; border: none; padding: 2px 0; color: var(--accent); font-weight: 600; cursor: pointer; font-size: calc(13px * var(--content-scale, 1)); }
.rd-logs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.rd-logs li { display: flex; align-items: center; gap: 8px; font-size: calc(13px * var(--content-scale, 1)); }
.rd-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.rd-dot.ok { background: var(--accent); }
.rd-dot.bad { background: var(--danger); }
.rd-time { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rd-actions { display: flex; gap: 8px; justify-content: flex-end; }
.rd-btn { min-height: 40px; padding: 8px 18px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); font-weight: 600; cursor: pointer; font-size: calc(14px * var(--content-scale, 1)); }
.rd-btn.pri { background: var(--accent); border-color: var(--accent); color: #fff; }
.rd-empty { margin: 0; color: var(--text-muted); font-size: calc(14px * var(--content-scale, 1)); line-height: 1.6; }
</style>
