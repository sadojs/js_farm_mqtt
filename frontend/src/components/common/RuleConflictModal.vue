<template>
  <div v-if="current" class="conflict-overlay">
    <div class="conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
      <div class="conflict-icon" aria-hidden="true">⚠️</div>
      <h3 id="conflict-title" class="conflict-title">자동제어 룰이 서로 충돌합니다</h3>
      <p class="conflict-lead">
        <strong>{{ current.deviceName }}</strong> 을(를) 두 룰이 반대로 제어하고 있습니다.
      </p>

      <div class="conflict-rules">
        <div class="rule winner">
          <span class="tag">적용 중</span>
          <span class="name">{{ current.winner.name }}</span>
          <span class="want">{{ wantKo(current.winner.want) }} · 우선순위 {{ current.winner.priority }}</span>
        </div>
        <div class="rule loser">
          <span class="tag muted">밀림</span>
          <span class="name">{{ current.loser.name }}</span>
          <span class="want">{{ wantKo(current.loser.want) }} · 우선순위 {{ current.loser.priority }}</span>
        </div>
      </div>

      <p class="conflict-help">
        우선순위가 높은 룰이 먼저 적용되고, 낮은 룰은 동작하지 않습니다.
        <strong>"{{ current.loser.name }}"</strong> 룰을 비활성화하면 이 충돌이 사라집니다. 룰은 삭제되지 않고 자동제어 화면에서 다시 켤 수 있습니다.
      </p>

      <div class="conflict-actions">
        <button class="btn keep" :disabled="busy" @click="decide('dismiss')">그대로 두기</button>
        <button class="btn apply" :disabled="busy" @click="decide('disable_loser')">
          밀린 룰 비활성화
        </button>
      </div>
      <p v-if="queue.length > 1" class="conflict-more">다른 충돌 {{ queue.length - 1 }}건이 더 있습니다.</p>
      <p v-if="error" class="conflict-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { automationApi } from '../../api/automation.api'
import { onAutomationConflict, type RuleConflictPayload } from '../../composables/useWebSocket'
import { useNotificationStore } from '../../stores/notification.store'

const queue = ref<RuleConflictPayload[]>([])
const busy = ref(false)
const error = ref('')
const current = computed(() => queue.value[0] ?? null)
const notificationStore = useNotificationStore()

const WANT_KO: Record<string, string> = { on: '켜기', off: '끄기', open: '열기', close: '닫기' }
const wantKo = (w: string) => WANT_KO[w] ?? w

function add(c: RuleConflictPayload) {
  if (!queue.value.some((q) => q.id === c.id)) queue.value.push(c)
}

async function decide(action: 'disable_loser' | 'dismiss') {
  const c = current.value
  if (!c || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await automationApi.resolveConflict(c.id, action)
    if (action === 'disable_loser' && data.disabledRule) {
      notificationStore.info('룰 비활성화', `"${data.disabledRule.name}" 룰을 비활성화했습니다.`)
    }
    queue.value = queue.value.filter((q) => q.id !== c.id)
  } catch (e: any) {
    error.value = e?.response?.data?.message || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    busy.value = false
  }
}

let off: (() => boolean) | null = null
onMounted(async () => {
  off = onAutomationConflict(add)
  // 새로고침·재접속 뒤에도 아직 해결되지 않은 충돌을 다시 보여 준다
  try {
    const { data } = await automationApi.getConflicts()
    data.forEach(add)
  } catch { /* 권한 없음 등 — 팝업만 생략 */ }
})
onUnmounted(() => { off?.() })
</script>

<style scoped>
.conflict-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  padding: 20px;
  overscroll-behavior: contain;
}
.conflict-dialog {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-modal);
  padding: 24px;
  width: 100%;
  max-width: 440px;
  max-height: 90vh;
  overflow-y: auto;
  text-align: center;
}
.conflict-icon { font-size: calc(36px * var(--content-scale, 1)); margin-bottom: 8px; }
.conflict-title {
  font-size: calc(18px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.conflict-lead {
  font-size: calc(15px * var(--content-scale, 1));
  color: var(--text-secondary);
  margin-bottom: 14px;
}
.conflict-rules { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; text-align: left; }
.rule {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
}
.rule.winner { border-color: var(--accent); }
.tag {
  grid-row: 1 / span 2;
  font-size: calc(12px * var(--content-scale, 1));
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}
.tag.muted { background: var(--text-muted); }
.name { font-weight: 600; color: var(--text-primary); font-size: calc(15px * var(--content-scale, 1)); word-break: break-word; }
.want { color: var(--text-secondary); font-size: calc(13px * var(--content-scale, 1)); }
.conflict-help {
  font-size: calc(14px * var(--content-scale, 1));
  color: var(--text-secondary);
  line-height: 1.55;
  margin-bottom: 18px;
  text-align: left;
}
.conflict-help strong { color: var(--text-primary); }
.conflict-actions { display: flex; gap: 10px; }
.btn {
  flex: 1;
  min-height: 44px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: calc(15px * var(--content-scale, 1));
  cursor: pointer;
}
.btn:disabled { opacity: 0.6; cursor: default; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn.keep { background: var(--bg-hover); color: var(--text-primary); }
.btn.keep:hover:not(:disabled) { background: var(--border-color); }
.btn.apply { background: var(--warning); color: #fff; word-break: break-word; }
.btn.apply:hover:not(:disabled) { background: var(--warning-hover); }
.conflict-more { margin-top: 10px; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); }
.conflict-error { margin-top: 10px; font-size: calc(13px * var(--content-scale, 1)); color: var(--danger); }
</style>
