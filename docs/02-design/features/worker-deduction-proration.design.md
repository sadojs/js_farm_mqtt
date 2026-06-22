# Design — worker-deduction-proration

**Feature**: worker-deduction-proration
**Created**: 2026-06-22
**Phase**: Design — depends on `worker-deduction-proration.plan.md`

---

## 1. 전체 아키텍처

```
┌─ WorkerSettings (Vue) ───────────────────────────────┐
│  • 퇴사일 입력란 (nullable date)                       │
│  • 고정 공제 행마다 "일할" 체크박스                     │
│  → SaveWorkerPayload 에 endDate / deductions[*].prorate │
└──────────────────────────┬──────────────────────────┘
                           ▼
PUT /api/worker-payroll/workers/:id  body { ..., endDate, deductions:[{...,prorate}] }
                           ▼
┌─ WorkerPayrollService.saveWorker ──────────────────┐
│  • Worker.end_date 갱신                              │
│  • WorkerDeduction.prorate 갱신                      │
└──────────────────────────┬─────────────────────────┘
                           ▼
GET /api/worker-payroll/workers/:id/settlement?periodStart=YYYY-MM-01
                           ▼
┌─ computeReceipt (수정) ─────────────────────────────┐
│  ① working-day loop : cursor > endDate 인 날 제외    │
│  ② deductions.map :                                  │
│       prorateAmount(d, periodStart, periodEnd, worker)│
│       → { amount, prorationReason }                  │
└─────────────────────────┬──────────────────────────┘
                           ▼
┌─ WorkerSettlement (Vue) ───────────────────────────┐
│  • 공제 행 amount + 보조 텍스트(prorationReason)     │
│  • 4개국어 i18n                                       │
└─────────────────────────────────────────────────────┘

WorkerCalendar : endDate 이후 셀 회색 + "퇴사 후" 라벨
WorkerPayrollView : 일꾼 카드 우측에 "퇴사" 배지
```

---

## 2. DB 마이그레이션

### 2.1 `035_worker_end_date_proration.sql`

```sql
-- Migration 035: 일꾼 퇴사일 + 고정공제 일할 계산 옵션
-- 입사 첫 달·퇴사 달의 고정공제(숙소비 등) 를 사용일수 비율로 차감하기 위한 컬럼.

ALTER TABLE payroll_workers
  ADD COLUMN IF NOT EXISTS end_date DATE NULL;

COMMENT ON COLUMN payroll_workers.end_date IS
  '퇴사일. NULL=재직중. 그 일자까지 근무, 다음날부터 정산·달력에서 제외.';

ALTER TABLE payroll_deductions
  ADD COLUMN IF NOT EXISTS prorate BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN payroll_deductions.prorate IS
  '고정공제 일할 계산 적용 여부. TRUE(기본)=입사·퇴사 달에 사용일수 비율로 차감. FALSE=매달 정액 그대로(예: 4대보험).';

-- 인덱스: 퇴사 일꾼 조회용
CREATE INDEX IF NOT EXISTS idx_payroll_workers_end_date
  ON payroll_workers (user_id) WHERE end_date IS NULL;
```

### 2.2 호환성
- 기존 worker 들 `end_date = NULL` → 영향 없음
- 기존 deduction 들 `prorate = TRUE` → 다음 입사·퇴사 달부터 자동 적용 (재직 중인 일꾼은 영향 X)
- 이미 settle 된 `payroll_settlements.deductions_json` 은 스냅샷 — 변경 없음

---

## 3. Backend 변경

### 3.1 엔티티

**`worker.entity.ts`**
```typescript
@Column({ name: 'end_date', type: 'date', nullable: true })
endDate: string | null;
```

**`worker-deduction.entity.ts`**
```typescript
@Column({ name: 'prorate', type: 'boolean', default: true })
prorate: boolean;
```

### 3.2 DTO

**`worker.dto.ts`** — 추가/수정
```typescript
// SaveWorkerDto 안에 추가
@IsOptional()
@IsDateString()
endDate?: string | null;

// DeductionItemDto 안에 추가
@IsOptional()
@IsBoolean()
prorate?: boolean;
```

### 3.3 정산 함수 변경 — `computeReceipt` (worker-payroll.service.ts)

```typescript
// ─── 신규 헬퍼: 일할 계산 ────────────────────────────────
private prorateAmount(
  baseAmount: number,
  prorate: boolean,
  periodStart: string,        // YYYY-MM-DD
  periodEnd: string,
  worker: { startDate: string; endDate: string | null },
  lang: PayrollLang,
): { amount: number; prorationReason: string | null } {
  if (!prorate) return { amount: baseAmount, prorationReason: null };

  // 그 달의 전체 일수(달력일 기준)
  const ps = parseDate(periodStart);
  const monthStart = fmt(new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), 1)));
  const monthEnd = fmt(new Date(Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth() + 1, 0)));
  const monthDays = daysBetween(monthStart, monthEnd) + 1;  // 1..31

  // 실제 근무 가능 일수
  const effStart = worker.startDate > monthStart ? worker.startDate : monthStart;
  const effEnd =
    worker.endDate && worker.endDate < monthEnd ? worker.endDate : monthEnd;
  if (effStart > effEnd) return { amount: 0, prorationReason: 'no-overlap' };

  const effDays = daysBetween(effStart, effEnd) + 1;
  if (effDays >= monthDays) return { amount: baseAmount, prorationReason: null };

  const amount = Math.round((baseAmount * effDays) / monthDays);

  // 사유 텍스트 — i18n key 만 반환하고 프론트에서 조합. 우선 백엔드는 데이터만.
  const reason = JSON.stringify({
    key: 'prorationReason',
    base: baseAmount,
    days: effDays,
    total: monthDays,
    entryInMonth: effStart > monthStart ? effStart : null,
    exitInMonth: effEnd < monthEnd ? effEnd : null,
  });
  return { amount, prorationReason: reason };
}
```

**`computeReceipt` 변경 부분**:
```typescript
// (1) working-day loop 안: endDate 이후 제외
if (!beforeStart && (!worker.endDate || cursor <= worker.endDate) && status === 'work') {
  workDays += 1;
  totalHours += hours;
}

// (2) deductions.map 안: 일할 적용
const deductions = deductionRows.map((d) => {
  const kind = d.kind === 'variable' ? 'variable' : 'fixed';
  if (kind === 'variable') {
    return {
      label: d.label,
      kind,
      amount: Math.max(0, Math.round(variableAmounts?.[d.id] ?? 0)),
      prorationReason: null,
    };
  }
  // fixed
  const { amount, prorationReason } = this.prorateAmount(
    d.amount,
    d.prorate !== false,            // 기본값 true
    meta.periodStart,
    meta.periodEnd,
    worker,
    'ko',
  );
  return { label: d.label, kind, amount, prorationReason };
});
```

### 3.4 saveWorker 변경
- `worker.entity` 의 endDate 갱신
- `replaceDeductions` 의 deduction insert 시 `prorate` 함께 저장

### 3.5 getCalendar 변경
- working-day loop 동일하게 `cursor > endDate` 인 날은 status 를 그대로 두되 days 배열에 `terminated: true` 플래그 첨부 (UI 가 회색 처리)

### 3.6 권한 / 영향 카운트 / 활성 일꾼 목록
- `WorkerPayrollService.listWorkers` 에서 퇴사일 정보 함께 반환 (`endDate`)
- 정산 이력은 그대로 (스냅샷)
- 자동 비활성화 — 현재 `is_active` 컬럼은 그대로 사용자가 토글. endDate 입력해도 is_active 자동 해제 X (사용자가 선택)

---

## 4. Frontend 변경

### 4.1 타입 (`worker-payroll.types.ts`)

```typescript
export interface Deduction {
  id?: string
  label: string
  kind?: DeductionKind
  amount: number
  prorate?: boolean         // 신규 — 고정 공제만 의미. 변동은 무시
  sortOrder?: number
}

export interface Worker {
  id: string
  name: string
  phone?: string | null
  startDate: string
  endDate?: string | null   // 신규
  hourlyWage: number
  dailyHours: number
  isActive: boolean
  // ...
}

export interface SaveWorkerPayload {
  // ...
  endDate?: string | null   // 신규 — null 보내면 퇴사 해제
  deductions?: Deduction[]
}

export interface SettlementDeductionLine {
  label: string
  kind: DeductionKind
  amount: number
  prorationReason: string | null   // 신규
}
```

### 4.2 WorkerSettings.vue

**② 근무조건 카드** — 퇴사일 추가:
```vue
<div class="grid2">
  <div class="field">
    <span>{{ t(lang, 'startDate') }}</span>
    <input v-model="form.startDate" type="date" class="inp" />
  </div>
  <div class="field">
    <span>{{ t(lang, 'endDate') }}</span>
    <div class="end-date-row">
      <input v-model="form.endDate" type="date" class="inp" :min="form.startDate || undefined" />
      <button v-if="form.endDate" class="btn-ghost-sm" @click="form.endDate = ''">{{ t(lang, 'clear') }}</button>
    </div>
    <span class="hint">{{ t(lang, 'endDateHelp') }}</span>
  </div>
</div>
```

**③ 공제 항목 — 고정 공제 행**:
```vue
<div v-for="(d, i) in form.fixedDeductions" :key="'f' + i" class="line-row deduction-row">
  <input v-model="d.label" class="inp flex" :placeholder="t(lang, 'deductionLabel')" />
  <input v-model.number="d.amount" type="number" min="0" step="10000" class="inp amount" :placeholder="t(lang, 'amount')" />
  <label class="prorate-toggle" :title="t(lang, 'prorateHint')">
    <input type="checkbox" v-model="d.prorate" />
    <span>{{ t(lang, 'prorate') }}</span>
  </label>
  <button class="btn-icon danger" @click="form.fixedDeductions.splice(i, 1)">−</button>
</div>
<p class="hint">{{ t(lang, 'prorateHint') }}</p>
```

**저장 로직** (`save` 함수 안):
```typescript
const saved = await workerPayrollApi.saveWorker({
  // ...
  endDate: form.endDate?.trim() || null,
  deductions: [
    ...form.fixedDeductions.map((d) => ({
      id: d.id, label: d.label.trim(), kind: 'fixed' as const,
      amount: Number(d.amount) || 0,
      prorate: d.prorate !== false,
    })),
    ...form.variableDeductions.map((d) => ({
      id: d.id, label: d.label.trim(), kind: 'variable' as const,
      amount: 0,
    })),
  ],
})
```

**검증**:
- endDate < startDate 면 저장 차단 + notify.warning

### 4.3 WorkerSettlement.vue

영수증 공제 라인에 보조 텍스트 추가:
```vue
<li v-for="ded in settlement.deductions" :key="ded.label" class="ded-line">
  <div class="ded-main">
    <span class="ded-label">{{ ded.label }}</span>
    <span class="ded-amount">{{ format(ded.amount) }}</span>
  </div>
  <p v-if="ded.prorationReason" class="ded-reason">
    {{ formatProrationReason(ded.prorationReason, lang) }}
  </p>
</li>
```

`formatProrationReason` (utils):
```typescript
function formatProrationReason(json: string, lang: PayrollLang): string {
  try {
    const d = JSON.parse(json)
    if (d.key !== 'prorationReason') return ''
    const base = d.base.toLocaleString()
    let txt = t(lang, 'prorationLineMain')
      .replace('{base}', base)
      .replace('{days}', String(d.days))
      .replace('{total}', String(d.total))
    if (d.entryInMonth) txt += ' ' + t(lang, 'entryNote').replace('{date}', shortMD(d.entryInMonth))
    if (d.exitInMonth)  txt += ' ' + t(lang, 'exitNote').replace('{date}', shortMD(d.exitInMonth))
    return txt
  } catch { return '' }
}
```

### 4.4 WorkerCalendar.vue

`cell.terminated === true` 인 날은:
- 배경 `var(--bg-hover)` + opacity 0.5
- 라벨 `{{ t(lang, 'terminated') }}` 표시
- 클릭 비활성화

### 4.5 WorkerPayrollView.vue 일꾼 목록

```vue
<div v-for="w in workers" :key="w.id" class="worker-item">
  <span>{{ w.name }}</span>
  <span v-if="w.endDate" class="badge-terminated">
    {{ t(lang, 'terminated') }} {{ shortMD(w.endDate) }}
  </span>
</div>
```

---

## 5. i18n 키 추가 (`payroll-i18n.ts`)

### 5.1 신규 키
| key | 용도 |
|---|---|
| `endDate` | "퇴사일" 라벨 |
| `endDateHelp` | "비워두면 재직 중" 안내 |
| `prorate` | "일할 계산" 체크박스 라벨 |
| `prorateHint` | "입사·퇴사 달은 사용일수 비율로 차감됩니다" 안내 |
| `prorationLineMain` | "월 {base}원 × {days}/{total}일" 보조 텍스트 메인 |
| `entryNote` | "({date} 입사)" |
| `exitNote` | "({date} 퇴사)" |
| `terminated` | "퇴사" / "퇴사 후" 배지·달력 |
| `clear` | "지우기" 버튼 |
| `startDate` | (이미 있을 가능성, 없으면 추가) |

### 5.2 번역

| key | ko | tl (필리핀) | th (태국) | lo (라오스) |
|---|---|---|---|---|
| endDate | 퇴사일 | Petsa ng pagtatapos | วันสิ้นสุด | ວັນສິ້ນສຸດ |
| endDateHelp | 비워두면 재직 중 | Iwanang blanko kung kasalukuyang nagtatrabaho | เว้นว่างหากยังทำงาน | ປະປ່ອຍຫວ່າງຖ້າຍັງເຮັດວຽກຢູ່ |
| prorate | 일할 계산 | Hatiin sa araw | คำนวณรายวัน | ຄິດໄລ່ຕາມມື້ |
| prorateHint | 입사·퇴사 달은 사용일수 비율로 차감됩니다 | Sa buwan ng pagsisimula/pagtatapos ay ibabawas batay sa bilang ng araw na natrabaho | เดือนเริ่มงาน/สิ้นสุดจะหักตามจำนวนวันที่ใช้งาน | ໃນເດືອນເລີ່ມຕົ້ນ/ສິ້ນສຸດຈະຫັກຕາມຈຳນວນມື້ທີ່ໃຊ້ |
| prorationLineMain | 월 {base}원 × {days}/{total}일 | {base}/buwan × {days}/{total} araw | {base}/เดือน × {days}/{total} วัน | {base}/ເດືອນ × {days}/{total} ມື້ |
| entryNote | ({date} 입사) | (Nagsimula {date}) | (เริ่ม {date}) | (ເລີ່ມ {date}) |
| exitNote | ({date} 퇴사) | (Nagtapos {date}) | (สิ้นสุด {date}) | (ສິ້ນສຸດ {date}) |
| terminated | 퇴사 | Tapos na | สิ้นสุด | ສິ້ນສຸດ |
| clear | 지우기 | Burahin | ล้าง | ລ້າງ |

---

## 6. 일할 계산 시나리오 — 검증표

| 시나리오 | 입사일 | 퇴사일 | 그달 일수 | 효력일수 | 월 80,000 → |
|---|---|---|---|---|---|
| 5월 입사 (5/17) | 2026-05-17 | NULL | 31 | 15 (17~31) | **38,710원** |
| 6월 (중간) | 2026-05-17 | NULL | 30 | 30 | **80,000원** |
| 8월 퇴사 (8/12) | 2026-05-17 | 2026-08-12 | 31 | 12 (1~12) | **30,968원** |
| 같은 달 입퇴사 (5/17 입, 5/25 퇴) | 2026-05-17 | 2026-05-25 | 31 | 9 (17~25) | **23,226원** |
| 2월 윤년 입사 (2/15) | 2024-02-15 | NULL | 29 | 15 (15~29) | **41,379원** |
| 4월 (30일달) 퇴사 (4/15) | 2026-01-01 | 2026-04-15 | 30 | 15 (1~15) | **40,000원** |
| prorate=false 일 때 입사첫달 | 2026-05-17 | NULL | 31 | 15 | **80,000원** (그대로) |
| 퇴사 후 9월 정산 시도 | 2026-05-17 | 2026-08-12 | 30 | 0 (no overlap) | 정산 불가 — periodStart>endDate 이면 정산 API 가 404 또는 빈 결과 |

Math.round 반올림 처리 — `38709.677 → 38710`.

---

## 7. 권한·보안

- 사용자 권한: 농장 관리자(`admin` / `farm_admin`) 만 endDate / prorate 수정
- `WorkerSettings` 안의 input 자체는 farm_admin 만 보이게 — 일꾼(`farm_user`) 본인 화면(`WorkerSelfView`) 에는 endDate 입력 X (값은 표시)

---

## 8. 정산 영수증 스냅샷 호환성

`worker_settlements.deductions_json` 컬럼은 정산 시점 스냅샷.
이번 변경으로 새로 settle 되는 row 의 `deductions_json[*]` 에 `prorationReason` 필드가 같이 저장됨.

기존 row 들은 `prorationReason` 키 없음 → 표시 안 함 (안전).

---

## 9. 구현 순서 (Do 체크리스트)

### 9.1 DB & Entity
- [ ] `035_worker_end_date_proration.sql` 작성 + 적용
- [ ] `worker.entity` endDate
- [ ] `worker-deduction.entity` prorate

### 9.2 Backend
- [ ] `worker.dto` endDate / prorate 검증
- [ ] `prorateAmount` 헬퍼
- [ ] `computeReceipt` 의 working-day loop 와 deductions.map 수정
- [ ] `saveWorker` / `replaceDeductions` 에서 prorate 저장 + worker.endDate 갱신
- [ ] `getCalendar` 의 days 배열에 `terminated` 플래그
- [ ] `listWorkers` 반환 객체에 endDate 포함

### 9.3 Frontend 타입·API
- [ ] `worker-payroll.types.ts` endDate / prorate / prorationReason 필드
- [ ] `worker-payroll.api.ts` 페이로드 그대로 (이미 generic JSON)

### 9.4 Frontend UI
- [ ] WorkerSettings: 퇴사일 input + 검증 (`endDate >= startDate`)
- [ ] WorkerSettings: 고정 공제 행에 prorate 체크박스 + 안내 텍스트
- [ ] WorkerSettlement: prorationReason 보조 텍스트
- [ ] WorkerCalendar: `terminated` 셀 회색 처리
- [ ] WorkerPayrollView: 일꾼 카드에 퇴사 배지

### 9.5 i18n
- [ ] payroll-i18n.ts 에 9개 키 추가
- [ ] ko / tl / th / lo 4개 언어 번역

### 9.6 검증
- [ ] 마이그레이션 통과
- [ ] nest build / vue-tsc EXIT 0
- [ ] 6장 검증표 8개 시나리오 — Manual 또는 API E2E
- [ ] 기존 일꾼·정산이력 회귀 없음

---

## 10. Open Questions

- [ ] 퇴사 후 자동으로 `is_active=false` 처리할지? — **현재는 사용자가 선택**. is_active 별도. 둘 다 노출.
- [ ] 퇴사일 미래로 입력 가능? — **허용** (예약 퇴사). 정산 시 그 달까지 처리.
- [ ] 일할 계산 단위 — **달력일 (월 31일)**. 주말 제외 옵션은 Out of Scope.
- [ ] 정산 영수증 PDF 출력 시 prorationReason 포함? — **포함**. WorkerSettlement 가 그대로 출력에 사용됨.
- [ ] 본인 화면(`WorkerSelfView`) 에서 퇴사일 보이게 할지? — **표시 O, 수정 X**.

---

## 11. PDCA 다음

→ `/pdca do worker-deduction-proration` — 위 9장 체크리스트 순서대로 구현
