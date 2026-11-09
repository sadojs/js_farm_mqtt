<template>
  <div class="card">
    <div class="ec-head">
      <h4 class="card-title">기타 고용비용</h4>
      <span class="ec-total">{{ won(total) }}</span>
    </div>
    <p class="hint">급여 외에 농장이 부담한 비용 (총 고용비용에 합산)</p>

    <ul v-if="items.length" class="ec-list">
      <li v-for="c in items" :key="c.id" class="ec-item">
        <div class="ec-main">
          <span class="ec-label">{{ c.label }}</span>
          <span class="ec-meta">
            <template v-if="c.date">{{ md(c.date) }} · </template>
            <template v-if="c.workerName">{{ c.workerName }} · </template>
            <template v-if="c.note">{{ c.note }}</template>
          </span>
        </div>
        <span class="ec-amt">{{ c.amount.toLocaleString() }}원</span>
        <button class="btn-icon" title="수정" aria-label="수정" @click="edit(c)">✎</button>
        <button class="btn-icon danger" title="삭제" aria-label="삭제" @click="remove(c)">−</button>
      </li>
    </ul>
    <p v-else class="hint">아직 입력한 비용이 없습니다.</p>

    <!-- 입력 -->
    <div class="ec-form">
      <div class="presets">
        <button v-for="p in PRESETS" :key="p" type="button" :class="['preset', { active: form.label === p }]" @click="form.label = p">{{ p }}</button>
      </div>
      <input v-model="form.label" class="inp" placeholder="항목 (예: 항공권)" maxlength="60" />
      <div class="row">
        <input v-model.number="form.amount" type="number" min="0" step="10000" class="inp amt" placeholder="금액" />
        <input v-model="form.date" type="date" class="inp" :min="`${year}-01-01`" :max="`${year}-12-31`" />
      </div>
      <div class="row">
        <select v-model="form.workerId" class="inp">
          <option value="">일꾼 지정 안 함 (농장 전체)</option>
          <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <input v-model="form.note" class="inp" placeholder="메모 (선택)" maxlength="120" />
      </div>
      <div class="row end">
        <button v-if="editingId" type="button" class="btn-ghost" @click="reset">취소</button>
        <button type="button" class="btn-primary" :disabled="busy" @click="save">{{ editingId ? '수정' : '추가' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { useConfirm } from '../../../composables/useConfirm'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { ExtraCost, Worker } from '../types/worker-payroll.types'
import { md, won } from '../utils/payroll-utils'

const props = defineProps<{ year: number }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const notify = useNotificationStore()
const { confirm: confirmDialog } = useConfirm()

const PRESETS = ['항공권', '비자·수수료', '숙소 관리·공과금', '보험(농장 부담분)']
const items = ref<ExtraCost[]>([])
const workers = ref<Worker[]>([])
const busy = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({ label: '', amount: 0, date: '', workerId: '', note: '' })
const total = computed(() => items.value.reduce((s, c) => s + c.amount, 0))

async function load() {
  items.value = await workerPayrollApi.listExtraCosts(props.year)
}

function reset() {
  editingId.value = null
  Object.assign(form, { label: '', amount: 0, date: '', workerId: '', note: '' })
}

function edit(c: ExtraCost) {
  editingId.value = c.id
  Object.assign(form, {
    label: c.label,
    amount: c.amount,
    date: c.date ? c.date.slice(0, 10) : '',
    workerId: c.workerId ?? '',
    note: c.note ?? '',
  })
}

async function save() {
  if (!form.label.trim()) {
    notify.warning('일꾼 관리', '항목 이름을 입력해 주세요.')
    return
  }
  const amount = Number(form.amount)
  if (!amount || amount < 0) {
    notify.warning('일꾼 관리', '금액을 입력해 주세요.')
    return
  }
  busy.value = true
  const payload = {
    year: props.year,
    date: form.date || null,
    workerId: form.workerId || null,
    label: form.label.trim(),
    amount: Math.round(amount),
    note: form.note.trim() || null,
  }
  try {
    if (editingId.value) await workerPayrollApi.updateExtraCost(editingId.value, payload)
    else await workerPayrollApi.createExtraCost(payload)
    reset()
    await load()
    emit('changed')
  } catch (e: any) {
    const msg = e?.response?.data?.message
    notify.error('일꾼 관리', Array.isArray(msg) ? msg.join(', ') : msg ?? '저장에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

async function remove(c: ExtraCost) {
  const ok = await confirmDialog({
    title: '비용 항목 삭제',
    message: `"${c.label}" ${c.amount.toLocaleString()}원을 삭제할까요? 연간 결산 총 고용비용에서 빠지며 되돌릴 수 없습니다.`,
    confirmText: '삭제',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await workerPayrollApi.removeExtraCost(c.id)
    if (editingId.value === c.id) reset()
    await load()
    emit('changed')
  } catch {
    notify.error('일꾼 관리', '삭제에 실패했습니다.')
  }
}

watch(() => props.year, () => { reset(); load() })
onMounted(async () => {
  await load()
  try { workers.value = await workerPayrollApi.listWorkers() } catch { /* 일꾼 선택만 비활성 */ }
})
</script>

<style scoped>
.card {
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 14px;
  box-shadow: var(--shadow-card); padding: 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0;
}
.card-title { font-size: var(--font-size-label); font-weight: 700; color: var(--text-primary); }
.ec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ec-total { font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.hint { color: var(--text-muted); font-size: var(--font-size-caption); }
.ec-list { display: flex; flex-direction: column; gap: 6px; }
.ec-item { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--border-light); }
.ec-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ec-label { color: var(--text-primary); font-weight: 600; font-size: var(--font-size-label); }
.ec-meta { color: var(--text-muted); font-size: var(--font-size-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-amt { font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 700; white-space: nowrap; }
.btn-icon {
  width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border-input);
  background: var(--bg-card); color: var(--text-muted); cursor: pointer; flex-shrink: 0;
}
.btn-icon:hover { background: var(--bg-hover); }
.btn-icon.danger:hover { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
.ec-form { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px dashed var(--border-input); }
.presets { display: flex; flex-wrap: wrap; gap: 6px; }
.preset {
  border: 1px solid var(--border-input); background: var(--bg-card); color: var(--text-secondary);
  border-radius: 16px; padding: 4px 10px; font-size: var(--font-size-caption); cursor: pointer;
}
.preset.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; }
.inp {
  flex: 1 1 120px; min-width: 0; padding: 9px 10px; border: 1px solid var(--border-input);
  border-radius: 8px; background: var(--bg-input); color: var(--text-primary); box-sizing: border-box;
}
.inp.amt { text-align: right; font-variant-numeric: tabular-nums; }
.btn-primary {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 9px 18px; font-weight: 700; cursor: pointer;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.6; }
.btn-ghost {
  border: 1px solid var(--border-input); background: var(--bg-card); color: var(--text-secondary);
  border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer;
}
</style>
