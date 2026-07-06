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
          <span>퇴사일</span>
          <div class="end-date-row">
            <input
              v-model="form.endDate"
              type="date"
              class="inp"
              :min="form.startDate || undefined"
            />
            <button v-if="form.endDate" type="button" class="btn-ghost-sm" @click="form.endDate = ''" title="퇴사일 지우기">✕</button>
          </div>
          <span class="hint inline">비워두면 재직 중</span>
        </label>
        <label class="field">
          <span>기본 근무시간 (시간/일)</span>
          <input v-model.number="form.dailyHours" type="number" min="0" step="0.5" class="inp" />
        </label>
      </div>

      <!-- 급여 방식 -->
      <div class="field opt-field">
        <span>급여 방식</span>
        <div class="seg">
          <button type="button" :class="['seg-btn', { active: form.salaryType === 'hourly' }]" @click="form.salaryType = 'hourly'">시급</button>
          <button type="button" :class="['seg-btn', { active: form.salaryType === 'fixed_monthly' }]" @click="form.salaryType = 'fixed_monthly'">고정 월급</button>
        </div>
      </div>
      <div class="grid2">
        <label v-if="form.salaryType === 'hourly'" class="field">
          <span>시급 (원)</span>
          <input v-model.number="form.hourlyWage" type="number" min="0" step="100" class="inp" />
        </label>
        <label v-else class="field">
          <span>고정 월급 (원)</span>
          <input v-model.number="form.fixedMonthlySalary" type="number" min="0" step="10000" class="inp" placeholder="예: 2500000" />
        </label>
      </div>
      <p v-if="form.salaryType === 'fixed_monthly'" class="hint">
        입력한 월급이 매 정산기간에 지급됩니다. 입사·퇴사로 기간이 잘리면 사용일수 비율로 일할 계산됩니다. (기본 근무시간은 달력 표시에만 사용)
      </p>

      <!-- 정산 주기 -->
      <div class="field opt-field">
        <span>정산 주기</span>
        <div class="seg">
          <button type="button" :class="['seg-btn', { active: form.settlementCycleType === 'calendar_month' }]" @click="form.settlementCycleType = 'calendar_month'">매월 1일~말일</button>
          <button type="button" :class="['seg-btn', { active: form.settlementCycleType === 'anniversary' }]" @click="form.settlementCycleType = 'anniversary'">입사일 기준</button>
        </div>
      </div>
      <p class="hint">
        <template v-if="form.settlementCycleType === 'calendar_month'">
          매월 1일~말일 기준으로 마감됩니다(다음 달 1일 정산).
          <template v-if="form.startDate">(첫 달은 {{ startMD }}~말일, 이후 매월 1일~말일)</template>
        </template>
        <template v-else>
          입사일 기준으로 매월 정산됩니다 — 매월 <strong>{{ startDay }}일</strong>에 마감·정산.
          <template v-if="form.startDate">(예: {{ startMD }} 시작 → 매월 {{ startDay }}일 정산, 전월 {{ startDay }}일~당월 {{ prevDay }}일)</template>
        </template>
      </p>
    </div>

    <!-- ③ 공제 항목 (고정/변동) -->
    <div class="card">
      <h3 class="card-title">③ 공제 항목</h3>
      <p class="hint">매달 같은 금액은 '고정', 전기·수도·가스처럼 매달 바뀌는 항목은 '변동'으로 등록하세요.</p>

      <!-- 고정 공제 -->
      <div class="ded-section">
        <div class="ded-head"><span class="ded-title">고정 공제</span><span class="ded-sub">매달 동일 · 자동 차감</span></div>
        <div v-for="(d, i) in form.fixedDeductions" :key="'f' + i" class="line-row deduction-row">
          <input v-model="d.label" class="inp flex" placeholder="항목 (예: 숙소비)" />
          <input v-model.number="d.amount" type="number" min="0" step="1000" class="inp amount" placeholder="금액" />
          <label class="prorate-toggle" title="입사·퇴사 달은 사용일수 비율로 차감됩니다">
            <input type="checkbox" v-model="d.prorate" />
            <span>일할</span>
          </label>
          <button class="btn-icon danger" @click="form.fixedDeductions.splice(i, 1)">−</button>
        </div>
        <button class="btn-add" @click="form.fixedDeductions.push({ label: '', amount: 0, prorate: true })">+ 고정 항목 추가</button>
        <div class="sum-row">매월 고정 공제 합계 <strong>{{ fixedTotal.toLocaleString() }}원</strong></div>
        <p class="hint">💡 <b>일할</b> 체크 시 입사·퇴사 달은 사용일수 비율로 자동 차감됩니다 (예: 숙소비·식비). 4대보험처럼 매달 정액인 항목은 체크 해제.</p>
      </div>

      <!-- 변동 공제 -->
      <div class="ded-section variable">
        <div class="ded-head">
          <span class="ded-title">변동 공제</span>
          <span class="badge-var">매달 입력</span>
        </div>
        <p class="var-note">여기서는 항목만 등록하고, 금액은 정산할 때 그 달 고지서 값을 입력합니다.</p>
        <div v-for="(d, i) in form.variableDeductions" :key="'v' + i" class="line-row">
          <input v-model="d.label" class="inp flex" placeholder="항목 (예: 전기 · 수도 · 가스)" />
          <span class="var-amount">정산월마다 금액 입력</span>
          <button class="btn-icon danger" @click="form.variableDeductions.splice(i, 1)">−</button>
        </div>
        <button class="btn-add" @click="form.variableDeductions.push({ label: '' })">+ 변동 항목 추가</button>
      </div>
    </div>

    <!-- ④ 가불 내역 -->
    <div class="card">
      <h3 class="card-title">④ 가불 내역</h3>
      <template v-if="workerId">
        <p v-if="advances.length === 0" class="hint">아직 가불 내역이 없습니다.</p>

        <!-- 월별 그룹 (접기/펼치기) — 최근 달이 위, 기본은 최근 달만 펼침 -->
        <div v-for="grp in advanceMonths" :key="grp.month" class="adv-month">
          <button type="button" class="adv-month-head" @click="toggleMonth(grp.month)">
            <span class="adv-caret">{{ isMonthOpen(grp.month) ? '▾' : '▸' }}</span>
            <span class="adv-month-label">{{ grp.label }}</span>
            <span class="adv-month-meta">{{ grp.items.length }}건 · {{ grp.total.toLocaleString() }}원</span>
          </button>
          <div v-show="isMonthOpen(grp.month)" class="adv-month-body">
            <div v-for="adv in grp.items" :key="adv.id" class="line-row">
              <input :value="adv.date" type="date" class="inp" disabled />
              <input :value="adv.amount.toLocaleString()" class="inp amount" disabled />
              <span class="adv-note">{{ adv.note || '—' }}</span>
              <button class="btn-icon danger" @click="removeAdvance(adv.id)">−</button>
            </div>
          </div>
        </div>

        <!-- 가불 추가 -->
        <div class="line-row adv-add-row">
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
  endDate: '',
  salaryType: 'hourly' as 'hourly' | 'fixed_monthly',
  hourlyWage: 12000,
  fixedMonthlySalary: 0,
  settlementCycleType: 'calendar_month' as 'calendar_month' | 'anniversary',
  dailyHours: 8,
  fixedDeductions: [] as { id?: string; label: string; amount: number; prorate: boolean }[],
  variableDeductions: [] as { id?: string; label: string }[],
})

const accountUsername = ref<string | null>(null)
const advances = ref<Advance[]>([])
const newAdvance = reactive({ date: new Date().toISOString().slice(0, 10), amount: 0, note: '' })

const fixedTotal = computed(() =>
  form.fixedDeductions.reduce((s, d) => s + (Number(d.amount) || 0), 0),
)
const startMD = computed(() =>
  form.startDate ? `${Number(form.startDate.slice(5, 7))}/${Number(form.startDate.slice(8, 10))}` : '',
)
const startDay = computed(() => (form.startDate ? Number(form.startDate.slice(8, 10)) : 0))
const prevDay = computed(() => (startDay.value > 1 ? startDay.value - 1 : '말'))

// ── 가불 내역 월별 그룹 + 접기/펼치기 ──
const expandedMonths = ref<Set<string>>(new Set())

const advanceMonths = computed(() => {
  const groups: Record<string, Advance[]> = {}
  for (const a of advances.value) {
    const m = (a.date || '').slice(0, 7)
    if (!m) continue
    ;(groups[m] ||= []).push(a)
  }
  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1)) // 최근 달 먼저
    .map((month) => {
      const items = groups[month]
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1)) // 달 안에서도 최근 날짜 먼저
      const [y, mm] = month.split('-')
      return {
        month,
        label: `${Number(y)}년 ${Number(mm)}월`,
        items,
        total: items.reduce((s, a) => s + (Number(a.amount) || 0), 0),
      }
    })
})

function isMonthOpen(month: string): boolean {
  return expandedMonths.value.has(month)
}
function toggleMonth(month: string) {
  const next = new Set(expandedMonths.value)
  if (next.has(month)) next.delete(month)
  else next.add(month)
  expandedMonths.value = next
}
/** 기본 펼침: 가장 최근 달만 */
function defaultExpandLatest() {
  const months = [...new Set(advances.value.map((a) => (a.date || '').slice(0, 7)).filter(Boolean))].sort()
  expandedMonths.value = months.length ? new Set([months[months.length - 1]]) : new Set()
}

async function load() {
  if (!props.workerId) {
    form.name = ''
    form.username = ''
    form.password = ''
    form.phone = ''
    form.startDate = new Date().toISOString().slice(0, 10)
    form.endDate = ''
    form.salaryType = 'hourly'
    form.hourlyWage = 12000
    form.fixedMonthlySalary = 0
    form.settlementCycleType = 'calendar_month'
    form.dailyHours = 8
    form.fixedDeductions = []
    form.variableDeductions = []
    accountUsername.value = null
    advances.value = []
    expandedMonths.value = new Set()
    return
  }
  const w = await workerPayrollApi.getWorker(props.workerId)
  form.name = w.name
  form.phone = w.phone ?? ''
  form.startDate = w.startDate.slice(0, 10)
  form.endDate = w.endDate ? w.endDate.slice(0, 10) : ''
  form.salaryType = w.salaryType ?? 'hourly'
  form.hourlyWage = w.hourlyWage
  form.fixedMonthlySalary = w.fixedMonthlySalary ?? 0
  form.settlementCycleType = w.settlementCycleType ?? 'calendar_month'
  form.dailyHours = Number(w.dailyHours)
  const deds = w.deductions ?? []
  form.fixedDeductions = deds
    .filter((d) => (d.kind ?? 'fixed') !== 'variable')
    .map((d) => ({ id: d.id, label: d.label, amount: d.amount, prorate: d.prorate !== false }))
  form.variableDeductions = deds
    .filter((d) => d.kind === 'variable')
    .map((d) => ({ id: d.id, label: d.label }))
  accountUsername.value = w.username ?? null
  advances.value = await workerPayrollApi.listAdvances(props.workerId)
  defaultExpandLatest()
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
  if (form.endDate && form.endDate < form.startDate) {
    notify.warning('일꾼 관리', '퇴사일은 입사일 이후여야 합니다.')
    return
  }
  if (form.salaryType === 'fixed_monthly' && (!form.fixedMonthlySalary || form.fixedMonthlySalary <= 0)) {
    notify.warning('일꾼 관리', '고정 월급 금액을 입력해 주세요.')
    return
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
      endDate: form.endDate?.trim() || null,
      salaryType: form.salaryType,
      hourlyWage: form.hourlyWage,
      fixedMonthlySalary: form.salaryType === 'fixed_monthly' ? form.fixedMonthlySalary : 0,
      settlementCycleType: form.settlementCycleType,
      dailyHours: form.dailyHours,
      deductions: [
        ...form.fixedDeductions
          .filter((d) => d.label.trim())
          .map((d) => ({
            id: d.id,
            label: d.label.trim(),
            kind: 'fixed' as const,
            amount: Number(d.amount) || 0,
            prorate: d.prorate !== false,
          })),
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
  if (!props.workerId) {
    notify.warning('일꾼 관리', '먼저 일꾼을 저장해 주세요.')
    return
  }
  if (!newAdvance.date) {
    notify.warning('일꾼 관리', '날짜를 선택해 주세요.')
    return
  }
  const amt = Number(newAdvance.amount)
  if (!amt || Number.isNaN(amt) || amt <= 0) {
    notify.warning('일꾼 관리', '가불 금액을 입력해 주세요.')
    return
  }
  const addedMonth = newAdvance.date.slice(0, 7)
  try {
    await workerPayrollApi.addAdvance(props.workerId, {
      date: newAdvance.date,
      amount: amt,
      note: newAdvance.note.trim() || undefined,
    })
    advances.value = await workerPayrollApi.listAdvances(props.workerId)
    // 방금 추가한 달은 펼쳐서 바로 보이게
    expandedMonths.value = new Set(expandedMonths.value).add(addedMonth)
    newAdvance.date = new Date().toISOString().slice(0, 10)
    newAdvance.amount = 0
    newAdvance.note = ''
    notify.success('일꾼 관리', '가불을 추가했습니다.')
  } catch (e: any) {
    notify.error('일꾼 관리', e?.response?.data?.message ?? '가불 추가에 실패했습니다.')
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

/* 가불 내역 월별 그룹 (접기/펼치기) */
.adv-month { border: 1px solid var(--border-input); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
.adv-month-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 12px; border: none; background: var(--bg-hover);
  cursor: pointer; text-align: left; color: var(--text-primary);
  font-size: var(--font-size-label); font-weight: 700;
}
.adv-month-head:hover { background: var(--bg-active); }
.adv-caret { width: 14px; flex: 0 0 auto; color: var(--text-muted); font-size: 12px; }
.adv-month-label { flex: 1 1 auto; }
.adv-month-meta { flex: 0 0 auto; font-size: var(--font-size-caption); font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.adv-month-body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
.adv-add-row { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-input); }
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
/* 퇴사일 입력란 — date input + 지우기 버튼 */
.end-date-row { display: flex; align-items: center; gap: 6px; }
.end-date-row .inp { flex: 1 1 auto; }
.btn-ghost-sm {
  background: var(--bg-hover);
  border: none;
  border-radius: 6px;
  width: 28px; height: 28px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}
.btn-ghost-sm:hover { background: var(--border-light); color: var(--text-primary); }
.hint.inline { display: block; margin-top: 4px; }

/* 고정공제 행 일할 토글 */
.prorate-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 8px;
  background: var(--bg-hover);
  border-radius: 8px;
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.prorate-toggle input[type="checkbox"] { margin: 0; cursor: pointer; }
.prorate-toggle:hover { background: var(--border-light); }

/* 급여방식 / 정산주기 세그먼트 토글 */
.opt-field { gap: 6px; }
.seg {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  overflow: hidden;
  max-width: 100%;
}
.seg-btn {
  padding: 8px 16px;
  border: none;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 600;
  font-size: var(--font-size-caption);
  white-space: nowrap;
}
.seg-btn + .seg-btn { border-left: 1px solid var(--border-input); }
.seg-btn.active { background: var(--accent); color: #fff; }
.seg-btn:not(.active):hover { background: var(--bg-hover); }

@media (max-width: 768px) {
  .grid2 { grid-template-columns: 1fr; }
  .deduction-row .inp { flex: 1 1 100%; }
  .deduction-row .amount { flex: 1 1 60%; }
  .deduction-row .prorate-toggle { flex: 0 0 auto; }
}
</style>
