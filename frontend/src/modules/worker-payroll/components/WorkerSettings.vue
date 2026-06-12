<template>
  <div class="worker-settings">
    <!-- ① 로그인 계정 (신규 등록 시) -->
    <div class="card">
      <h3 class="card-title">① 로그인 계정</h3>
      <template v-if="!workerId">
        <div class="grid2">
          <label class="field">
            <span>이름</span>
            <input v-model="form.name" class="inp" placeholder="일꾼 이름" />
          </label>
          <label class="field">
            <span>연락처 (선택)</span>
            <input v-model="form.phone" class="inp" placeholder="010-0000-0000" />
          </label>
          <label class="field">
            <span>아이디 (로그인용)</span>
            <input v-model="form.username" class="inp" placeholder="lee-worker" autocapitalize="off" />
          </label>
          <label class="field">
            <span>임시 비밀번호</span>
            <input v-model="form.password" type="text" class="inp" placeholder="첫 로그인 시 변경 안내" />
          </label>
        </div>
        <p class="hint">아이디는 영문 소문자·숫자로, 일꾼에게 전달됩니다. 권한: 농장 사용자(일꾼) — 본인 데이터만 조회, 수정 불가.</p>
      </template>
      <p v-else class="account-readonly">
        아이디 <strong>{{ accountUsername || '—' }}</strong> · 권한: 농장 사용자(일꾼). 계정 정보는 등록 후 변경할 수 없습니다.
      </p>
    </div>

    <!-- ② 근무조건 -->
    <div class="card">
      <h3 class="card-title">② 근무조건</h3>
      <div class="grid2">
        <label v-if="workerId" class="field">
          <span>이름</span>
          <input v-model="form.name" class="inp" placeholder="일꾼 이름" />
        </label>
        <label class="field">
          <span>근무시작일</span>
          <input v-model="form.startDate" type="date" class="inp" />
        </label>
        <label class="field">
          <span>시급 (원)</span>
          <input v-model.number="form.hourlyWage" type="number" min="0" step="100" class="inp" />
        </label>
        <label class="field">
          <span>기본 근무시간 (시간/일)</span>
          <input v-model.number="form.dailyHours" type="number" min="0" step="0.5" class="inp" />
        </label>
      </div>
      <p class="hint">
        정산은 근무시작일 기준 매월 같은 날 마감됩니다.
        <template v-if="form.startDate">({{ anchorDay }}일 시작 → 매월 {{ anchorDay }}일 정산)</template>
      </p>
    </div>

    <!-- ③ 공제 항목 (고정/변동) -->
    <div class="card">
      <h3 class="card-title">③ 공제 항목</h3>
      <p class="hint">매달 같은 금액은 '고정', 전기·수도·가스처럼 매달 바뀌는 항목은 '변동'으로 등록하세요.</p>

      <!-- 고정 공제 -->
      <div class="ded-section">
        <div class="ded-head"><span class="ded-title">고정 공제</span><span class="ded-sub">매달 동일 · 자동 차감</span></div>
        <div v-for="(d, i) in form.fixedDeductions" :key="'f' + i" class="line-row">
          <input v-model="d.label" class="inp flex" placeholder="항목 (예: 숙소비)" />
          <input v-model.number="d.amount" type="number" min="0" step="1000" class="inp amount" placeholder="금액" />
          <button class="btn-icon danger" @click="form.fixedDeductions.splice(i, 1)">−</button>
        </div>
        <button class="btn-add" @click="form.fixedDeductions.push({ label: '', amount: 0 })">+ 고정 항목 추가</button>
        <div class="sum-row">매월 고정 공제 합계 <strong>{{ fixedTotal.toLocaleString() }}원</strong></div>
      </div>

      <!-- 변동 공제 -->
      <div class="ded-section variable">
        <div class="ded-head">
          <span class="ded-title">변동 공제</span>
          <span class="badge-var">매달 입력</span>
        </div>
        <p class="var-note">설정에는 항목만 등록하고, 금액은 정산할 때 그 달 고지서 값을 입력합니다.</p>
        <div v-for="(d, i) in form.variableDeductions" :key="'v' + i" class="line-row">
          <input v-model="d.label" class="inp flex" placeholder="항목 (예: 전기 · 수도 · 가스)" />
          <span class="var-amount">정산월마다 금액 입력</span>
          <button class="btn-icon danger" @click="form.variableDeductions.splice(i, 1)">−</button>
        </div>
        <button class="btn-add" @click="form.variableDeductions.push({ label: '' })">+ 변동 항목 추가</button>
      </div>
    </div>

    <!-- ③ 가불 내역 -->
    <div class="card">
      <h3 class="card-title">④ 가불 내역</h3>
      <template v-if="workerId">
        <div v-for="adv in advances" :key="adv.id" class="line-row">
          <input :value="adv.date" type="date" class="inp" disabled />
          <input :value="adv.amount.toLocaleString()" class="inp amount" disabled />
          <span class="adv-note">{{ adv.note || '—' }}</span>
          <button class="btn-icon danger" @click="removeAdvance(adv.id)">−</button>
        </div>
        <div class="line-row">
          <input v-model="newAdvance.date" type="date" class="inp" />
          <input v-model.number="newAdvance.amount" type="number" min="0" step="10000" class="inp amount" placeholder="금액" />
          <input v-model="newAdvance.note" class="inp flex" placeholder="메모 (예: 병원비)" />
          <button class="btn-add small" @click="addAdvance">추가</button>
        </div>
      </template>
      <p v-else class="hint">먼저 일꾼을 저장하면 가불 내역을 추가할 수 있습니다.</p>
    </div>

    <div class="actions">
      <button v-if="workerId" class="btn-danger" @click="$emit('delete')">일꾼 삭제</button>
      <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '저장 중…' : '저장' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { workerPayrollApi } from '../api/worker-payroll.api'
import type { Worker, Advance } from '../types/worker-payroll.types'

const props = defineProps<{ workerId: string | null }>()
const emit = defineEmits<{ (e: 'saved', worker: Worker): void; (e: 'delete'): void }>()

const notify = useNotificationStore()
const saving = ref(false)

const form = reactive({
  name: '',
  username: '',
  password: '',
  phone: '',
  startDate: new Date().toISOString().slice(0, 10),
  hourlyWage: 12000,
  dailyHours: 8,
  fixedDeductions: [] as { id?: string; label: string; amount: number }[],
  variableDeductions: [] as { id?: string; label: string }[],
})

const accountUsername = ref<string | null>(null)
const advances = ref<Advance[]>([])
const newAdvance = reactive({ date: new Date().toISOString().slice(0, 10), amount: 0, note: '' })

const fixedTotal = computed(() =>
  form.fixedDeductions.reduce((s, d) => s + (Number(d.amount) || 0), 0),
)
const anchorDay = computed(() =>
  form.startDate ? Number(form.startDate.slice(8, 10)) : 0,
)

async function load() {
  if (!props.workerId) {
    form.name = ''
    form.username = ''
    form.password = ''
    form.phone = ''
    form.startDate = new Date().toISOString().slice(0, 10)
    form.hourlyWage = 12000
    form.dailyHours = 8
    form.fixedDeductions = []
    form.variableDeductions = []
    accountUsername.value = null
    advances.value = []
    return
  }
  const w = await workerPayrollApi.getWorker(props.workerId)
  form.name = w.name
  form.phone = w.phone ?? ''
  form.startDate = w.startDate.slice(0, 10)
  form.hourlyWage = w.hourlyWage
  form.dailyHours = Number(w.dailyHours)
  const deds = w.deductions ?? []
  form.fixedDeductions = deds
    .filter((d) => (d.kind ?? 'fixed') !== 'variable')
    .map((d) => ({ id: d.id, label: d.label, amount: d.amount }))
  form.variableDeductions = deds
    .filter((d) => d.kind === 'variable')
    .map((d) => ({ id: d.id, label: d.label }))
  accountUsername.value = w.username ?? null
  advances.value = await workerPayrollApi.listAdvances(props.workerId)
}

watch(() => props.workerId, load)
onMounted(load)

async function save() {
  if (!form.name.trim()) {
    notify.warning('일꾼 관리', '이름을 입력해 주세요.')
    return
  }
  const isNew = !props.workerId
  if (isNew) {
    if (!/^[a-z][a-z0-9_-]{2,49}$/.test(form.username.trim())) {
      notify.warning('일꾼 관리', '아이디는 영문 소문자로 시작하고 소문자·숫자·_·- 만 사용해 주세요.')
      return
    }
    if (form.password.trim().length < 6) {
      notify.warning('일꾼 관리', '임시 비밀번호는 6자 이상 입력해 주세요.')
      return
    }
  }
  saving.value = true
  try {
    const saved = await workerPayrollApi.saveWorker({
      id: props.workerId ?? undefined,
      name: form.name.trim(),
      username: isNew ? form.username.trim() : undefined,
      password: isNew ? form.password : undefined,
      phone: form.phone.trim() || undefined,
      startDate: form.startDate,
      hourlyWage: form.hourlyWage,
      dailyHours: form.dailyHours,
      deductions: [
        ...form.fixedDeductions
          .filter((d) => d.label.trim())
          .map((d) => ({ id: d.id, label: d.label.trim(), kind: 'fixed' as const, amount: Number(d.amount) || 0 })),
        ...form.variableDeductions
          .filter((d) => d.label.trim())
          .map((d) => ({ id: d.id, label: d.label.trim(), kind: 'variable' as const, amount: 0 })),
      ].map((d, i) => ({ ...d, sortOrder: i })),
    })
    notify.success('일꾼 관리', isNew ? '일꾼 계정을 등록했습니다.' : '근무조건을 저장했습니다.')
    emit('saved', saved)
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
}

async function addAdvance() {
  if (!props.workerId || !newAdvance.amount) return
  try {
    await workerPayrollApi.addAdvance(props.workerId, {
      date: newAdvance.date,
      amount: newAdvance.amount,
      note: newAdvance.note.trim() || undefined,
    })
    advances.value = await workerPayrollApi.listAdvances(props.workerId)
    newAdvance.amount = 0
    newAdvance.note = ''
    notify.success('일꾼 관리', '가불을 추가했습니다.')
  } catch {
    notify.error('일꾼 관리', '가불 추가에 실패했습니다.')
  }
}

async function removeAdvance(id: string) {
  if (!props.workerId) return
  try {
    await workerPayrollApi.removeAdvance(id)
    advances.value = await workerPayrollApi.listAdvances(props.workerId)
  } catch {
    notify.error('일꾼 관리', '가불 삭제에 실패했습니다.')
  }
}
</script>

<style scoped>
.worker-settings { display: flex; flex-direction: column; gap: 16px; }
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-title { font-size: var(--font-size-label); font-weight: 700; color: var(--text-primary); }
.grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field span { font-size: var(--font-size-caption); color: var(--text-secondary); font-weight: 600; }
.inp {
  padding: 10px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  min-width: 0;
  box-sizing: border-box;
}
.field .inp { width: 100%; }
.inp:disabled { background: var(--bg-hover); color: var(--text-muted); }
.hint { color: var(--text-muted); font-size: var(--font-size-caption); }
.account-readonly { color: var(--text-secondary); font-size: var(--font-size-label); }
.account-readonly strong { color: var(--text-primary); }
.line-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.line-row .inp { flex: 1 1 120px; }
.flex { flex: 1 1 120px; min-width: 0; }
.line-row .amount { flex: 0 1 130px; text-align: right; font-variant-numeric: tabular-nums; }
.adv-note { flex: 1 1 120px; min-width: 0; color: var(--text-secondary); font-size: var(--font-size-caption); }
.btn-icon {
  width: 32px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-input);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
}
.btn-icon.danger:hover { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
.btn-add {
  align-self: flex-start;
  background: none;
  border: 1px dashed var(--accent);
  color: var(--accent);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-weight: 600;
}
.btn-add.small { padding: 8px 14px; border-style: solid; }
.btn-add:hover { background: var(--accent-bg); }
.sum-row { color: var(--text-secondary); font-size: var(--font-size-label); }
.sum-row strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.ded-section { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border-light); border-radius: 12px; }
.ded-section.variable { border-color: var(--warning-border); background: var(--warning-bg); }
.ded-head { display: flex; align-items: center; gap: 8px; }
.ded-title { font-weight: 700; color: var(--text-primary); }
.ded-sub { font-size: var(--font-size-caption); color: var(--text-muted); }
.badge-var {
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--warning-text);
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: 6px;
  padding: 1px 8px;
}
.var-note { font-size: var(--font-size-caption); color: var(--warning-text); }
.var-amount {
  flex: 0 1 150px;
  text-align: right;
  font-size: var(--font-size-caption);
  color: var(--warning-text);
  font-weight: 600;
}
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.btn-save {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 11px 24px;
  font-weight: 600;
  cursor: pointer;
}
.btn-save:hover { background: var(--accent-hover); }
.btn-save:disabled { opacity: 0.6; }
.btn-danger {
  background: var(--danger-bg);
  color: var(--danger);
  border: none;
  border-radius: 8px;
  padding: 11px 20px;
  font-weight: 600;
  cursor: pointer;
}
@media (max-width: 768px) {
  .grid2 { grid-template-columns: 1fr; }
}
</style>
