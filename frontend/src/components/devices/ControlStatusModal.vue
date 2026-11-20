<template>
  <div v-if="deviceId" class="cs-overlay" @click.self="emit('close')">
    <div class="cs-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-title">
      <header class="cs-head">
        <h3 id="cs-title" class="cs-title">{{ status?.deviceName ?? deviceName ?? '장치' }}</h3>
        <span v-if="status" class="cs-pill" :class="pillClass">{{ pillText }}</span>
        <button class="cs-close" aria-label="닫기" @click="emit('close')">✕</button>
      </header>
      <p class="cs-sub">지금 누가 이 장치를 움직이는지 · 위에 있을수록 우선</p>

      <div v-if="loading && !status" class="cs-loading">불러오는 중…</div>
      <p v-else-if="error" class="cs-error">{{ error }}</p>

      <template v-if="status">
        <div v-if="status.lock" class="cs-lock">🔒 {{ status.lock.label }}</div>

        <div class="cs-now" :class="{ manual: status.winner?.source === 'manual' }">
          <div class="cs-now-text">
            <b>{{ status.winner ? `${status.winner.label}이(가) 제어 중` : '지금 제어 요청 없음' }}</b>
            <span>{{ status.winner ? status.winner.detail : '자동제어 규칙의 조건이 맞으면 그때 움직입니다.' }}</span>
          </div>
          <button v-if="status.manual.releasable" class="cs-btn" :disabled="releasing" @click="releaseManual">
            {{ releasing ? '해제 중…' : '지금 해제' }}
          </button>
        </div>

        <ol class="cs-ladder">
          <li v-for="(row, i) in visibleRows" :key="row.source" :class="row.state">
            <span class="no">{{ i + 1 }}</span>
            <span class="nm">{{ row.label }}</span>
            <span class="st">{{ row.state === 'win' ? '지금 제어 중 · ' + row.detail : row.detail }}</span>
          </li>
        </ol>

        <p class="cs-note">🔒 비상 정지는 순위가 아닌 잠금입니다. 걸려 있으면 해제 버튼을 누를 때까지 수동 조작을 포함해 켜는 명령이 모두 멈춥니다.</p>
        <p class="cs-time">{{ checkedText }}</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { automationApi, type ControlStatus } from '../../api/automation.api'
import { deviceApi } from '../../api/device.api'
import { notify } from '../../utils/dialogs'

const props = defineProps<{ deviceId: string | null; deviceName?: string }>()
const emit = defineEmits<{ close: []; released: [] }>()

const status = ref<ControlStatus | null>(null)
const loading = ref(false)
const error = ref('')
const releasing = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function load() {
  if (!props.deviceId) return
  loading.value = true
  try {
    const { data } = await automationApi.getControlStatus(props.deviceId)
    status.value = data
    error.value = ''
  } catch (e: any) {
    error.value = e?.response?.data?.message || '제어 현황을 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

watch(() => props.deviceId, (id) => {
  status.value = null
  if (timer) { clearInterval(timer); timer = null }
  if (!id) return
  load()
  timer = setInterval(load, 10_000) // 열려 있는 동안 10초마다 새로 읽는다
}, { immediate: true })
onUnmounted(() => { if (timer) clearInterval(timer) })

/** 관계없는 주체(예: 팬의 비 감지)는 숨긴다 */
const visibleRows = computed(() => (status.value?.ladder ?? []).filter(r => r.state !== 'na'))

const pillText = computed(() => {
  const s = status.value
  if (!s) return ''
  if (s.lock) return '비상 정지'
  if (!s.winner) return '대기'
  if (s.winner.source === 'manual') return '수동 조작 중'
  return s.winner.label
})
const pillClass = computed(() => {
  const s = status.value
  if (s?.lock) return 'bad'
  if (s?.winner?.source === 'manual') return 'info'
  return s?.winner ? 'ok' : ''
})
const checkedText = computed(() => {
  if (!status.value) return ''
  const d = new Date(status.value.checkedAt)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')} 기준 · 10초마다 새로 고침`
})

async function releaseManual() {
  if (!props.deviceId || releasing.value) return
  releasing.value = true
  try {
    await deviceApi.cancelTimer(props.deviceId)
    notify('수동 조작을 해제했습니다. 자동제어가 다시 맡습니다.', 'success')
    emit('released')
    await load()
  } catch {
    notify('해제에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error')
  } finally {
    releasing.value = false
  }
}
</script>

<style scoped>
.cs-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
  padding: 16px; overscroll-behavior: contain;
}
.cs-dialog {
  width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 16px; box-shadow: var(--shadow-modal); padding: 20px;
  display: flex; flex-direction: column; gap: 12px;
}
.cs-head { display: flex; align-items: center; gap: 8px; }
.cs-title { font-size: calc(18px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); margin: 0; flex: 1; min-width: 0; word-break: break-word; }
.cs-close { background: none; border: none; font-size: calc(18px * var(--content-scale, 1)); color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
.cs-sub { margin: -6px 0 0; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-muted); }
.cs-pill {
  flex-shrink: 0; padding: 3px 10px; border-radius: 999px;
  font-size: calc(12px * var(--content-scale, 1)); font-weight: 700;
  background: var(--bg-hover); color: var(--text-secondary);
}
.cs-pill.ok { background: var(--accent-bg); color: var(--accent); }
.cs-pill.info { background: var(--info-bg); color: var(--info); }
.cs-pill.bad { background: var(--danger-bg); color: var(--danger); }
.cs-loading, .cs-error { font-size: calc(14px * var(--content-scale, 1)); color: var(--text-muted); }
.cs-error { color: var(--danger); }
.cs-lock {
  padding: 10px 12px; border-radius: 10px; font-weight: 600;
  background: var(--danger-bg); color: var(--danger); font-size: calc(14px * var(--content-scale, 1));
}
.cs-now {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  background: var(--accent-bg); border: 1px solid var(--accent);
}
.cs-now.manual { background: var(--info-bg); border-color: var(--info); }
.cs-now-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.cs-now-text b { font-size: calc(15px * var(--content-scale, 1)); color: var(--text-primary); }
.cs-now-text span { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); line-height: 1.45; }
.cs-btn {
  flex-shrink: 0; min-height: 40px; padding: 8px 14px; border-radius: 8px; border: none;
  background: var(--info); color: #fff; font-weight: 700; cursor: pointer;
  font-size: calc(14px * var(--content-scale, 1));
}
.cs-btn:disabled { opacity: 0.6; cursor: default; }
.cs-ladder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cs-ladder li {
  display: grid; grid-template-columns: 24px auto 1fr; gap: 8px; align-items: baseline;
  padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border-light);
  font-size: calc(14px * var(--content-scale, 1)); color: var(--text-secondary);
}
.cs-ladder .no { font-weight: 700; color: var(--text-muted); text-align: center; font-variant-numeric: tabular-nums; }
.cs-ladder .nm { font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.cs-ladder .st { font-size: calc(13px * var(--content-scale, 1)); text-align: right; min-width: 0; word-break: keep-all; overflow-wrap: anywhere; }
.cs-ladder li.win { background: var(--accent-bg); border-color: var(--accent); }
.cs-ladder li.win .st { color: var(--accent); font-weight: 600; }
.cs-ladder li.lose { background: var(--warning-bg); border-color: var(--warning); }
.cs-ladder li.lose .st { color: var(--warning); }
.cs-ladder li.idle { opacity: 0.75; }
.cs-note { margin: 0; font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); line-height: 1.5; }
.cs-time { margin: -4px 0 0; font-size: calc(11px * var(--content-scale, 1)); color: var(--text-muted); text-align: right; }
@media (max-width: 480px) {
  .cs-ladder li { grid-template-columns: 22px 1fr; }
  .cs-ladder .st { grid-column: 2; text-align: left; }
}
</style>
