<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="`${workerName} 삭제`">
      <h3 class="modal-title">{{ workerName }} 삭제</h3>

      <p v-if="summary" class="records">
        남아 있는 기록: 시즌 {{ summary.seasons }}개 · 정산 {{ summary.settlements }}건(확정 {{ summary.confirmedSettlements }}건)
        · 가불 {{ summary.advances }}건 · 근무 조정 {{ summary.dayOverrides }}일<template v-if="summary.extraCosts"> · 기타 비용 {{ summary.extraCosts }}건</template>
      </p>
      <p v-else class="records">기록 건수를 불러오는 중…</p>

      <label :class="['opt', { active: mode === 'hide' }]">
        <input v-model="mode" type="radio" value="hide" />
        <span class="opt-body">
          <strong>목록에서만 삭제 (기록 유지) — 권장</strong>
          <span>일꾼 목록에서 사라지지만 근무·가불·정산 기록은 DB 에 그대로 남고, 정산 이력·연간 결산에도 계속 포함됩니다.<template v-if="summary?.hasAccount"> 일꾼 로그인 계정은 비활성화됩니다.</template></span>
        </span>
      </label>

      <label :class="['opt', 'danger', { active: mode === 'purge' }]">
        <input v-model="mode" type="radio" value="purge" />
        <span class="opt-body">
          <strong>기록까지 완전 삭제 (DB 삭제)</strong>
          <span>이 일꾼의 시즌·근무·가불·정산·기타 비용을 DB 에서 영구 삭제합니다. 정산 이력과 연간 결산 합계에서도 빠지며 <b>되돌릴 수 없습니다.</b><template v-if="summary?.hasAccount"> 로그인 계정도 삭제됩니다(동작 이력이 있으면 비활성화).</template></span>
        </span>
      </label>

      <label v-if="mode === 'purge'" class="field">
        <span>확인을 위해 일꾼 이름 <b>{{ workerName }}</b> 을(를) 입력하세요</span>
        <input v-model="typed" class="inp" :placeholder="workerName" autocomplete="off" />
      </label>

      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('close')">취소</button>
        <button
          :class="mode === 'purge' ? 'btn-danger' : 'btn-primary'"
          :disabled="busy || (mode === 'purge' && typed.trim() !== workerName)"
          @click="submit"
        >{{ busy ? '…' : mode === 'purge' ? '기록까지 영구 삭제' : '목록에서 삭제' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { WorkerRecordSummary } from '../types/worker-payroll.types'

const props = defineProps<{ workerId: string; workerName: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'deleted', purged: boolean): void }>()
const notify = useNotificationStore()

const summary = ref<WorkerRecordSummary | null>(null)
const mode = ref<'hide' | 'purge'>('hide')
const typed = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  try {
    const purge = mode.value === 'purge'
    await workerPayrollApi.removeWorker(props.workerId, purge)
    notify.info('일꾼 관리', purge ? `${props.workerName}님의 기록을 모두 삭제했습니다.` : `${props.workerName}님을 목록에서 삭제했습니다. (기록은 보존)`)
    emit('deleted', purge)
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '삭제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    summary.value = await workerPayrollApi.getRecordSummary(props.workerId)
  } catch { /* 건수 안내만 생략 */ }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
}
.modal {
  background: var(--bg-card); border-radius: 14px; box-shadow: var(--shadow-modal);
  padding: 22px; width: 100%; max-width: 500px; max-height: calc(100vh - 32px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
.modal-title { font-size: var(--font-size-subtitle); font-weight: 800; color: var(--text-primary); }
.records { background: var(--bg-hover); border-radius: 10px; padding: 10px 12px; color: var(--text-secondary); font-size: var(--font-size-caption); }
.opt {
  display: flex; gap: 10px; align-items: flex-start; cursor: pointer;
  border: 1px solid var(--border-input); border-radius: 12px; padding: 12px;
}
.opt.active { border-color: var(--accent); background: var(--accent-bg); }
.opt.danger.active { border-color: var(--danger); background: var(--danger-bg); }
.opt input { margin-top: 3px; }
.opt-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.opt-body strong { color: var(--text-primary); font-size: var(--font-size-label); }
.opt-body span { color: var(--text-secondary); font-size: var(--font-size-caption); line-height: 1.45; }
.opt.danger strong { color: var(--danger); }
.field { display: flex; flex-direction: column; gap: 4px; }
.field > span { font-size: var(--font-size-caption); color: var(--text-secondary); }
.inp {
  padding: 10px 12px; border: 1px solid var(--border-input); border-radius: 8px;
  background: var(--bg-input); color: var(--text-primary); width: 100%; box-sizing: border-box;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.btn-ghost {
  border: 1px solid var(--border-input); background: var(--bg-card); color: var(--text-secondary);
  border-radius: 8px; padding: 10px 18px; font-weight: 600; cursor: pointer;
}
.btn-primary, .btn-danger { border: none; border-radius: 8px; padding: 10px 20px; font-weight: 700; cursor: pointer; min-height: 44px; color: #fff; }
.btn-primary { background: var(--accent); }
.btn-danger { background: var(--danger); }
.btn-primary:disabled, .btn-danger:disabled { opacity: 0.5; cursor: default; }
</style>
