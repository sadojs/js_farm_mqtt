# Plan — worker-deduction-proration

**Feature**: worker-deduction-proration (공제항목 일할 계산 + 퇴사일 지정)
**Created**: 2026-06-22
**Owner**: 오정석
**Phase**: Plan

---

## 1. 배경 (Why)

현재 일꾼관리의 **고정 공제** (숙소비, 4대보험, 식비 등) 는 매달 똑같은 금액으로
정산된다.

```
worker-payroll.service.ts:457
amount = d.amount   // ← 매달 같은 금액 그대로
```

그러나 실제 운영에서는

- **입사 첫 달**: 월 중간에 입사 → 그 달은 일할 계산 필요
  예: 5/17 입사, 숙소비 80,000원/월 → 5월은 15일(17~31일)만 사용 → 38,710원
- **퇴사 달**: 월 중간에 퇴사 → 그 달도 일할 계산 필요
  예: 8/12 퇴사, 숙소비 80,000원/월 → 8월은 12일(1~12일)만 사용 → 30,968원
- **중간 달**: 입사·퇴사 모두 해당 월에 없으면 → 그대로 매달 정액 (80,000원)

또한 **퇴사일 자체가 입력 안 됨**. 일꾼이 그만둘 때 마지막 달 정산할 방법이 없다.

추가로 **공제 항목마다 일할 계산 정책이 다를 수 있음**:
- 숙소비 / 식비 / 통신비 등 **실비성** → 일할 계산 O
- 4대보험 / 회사 부담분 등 **법정성** → 일할 계산 X (월 단위 그대로)

→ 공제 항목별로 "일할 계산 적용" 옵션 선택 가능해야 함.

---

## 2. 목표 (What)

### Functional Goals

**[F1] 일꾼 퇴사일 입력**
- 일꾼 폼에 "퇴사일" 필드 추가 (선택값, nullable)
- 퇴사일 입력 시 그 일자 이후엔 근무 기록·정산 대상 제외
- 퇴사일 ≥ 입사일 검증

**[F2] 공제 항목 일할 계산 옵션**
- 각 고정 공제 항목에 `prorate: boolean` 추가 (default `true` — 일반적 일할)
- false 인 항목은 매달 정액 그대로 (4대보험 등)
- 변동 공제 (variable) 는 정산 시점 입력값 그대로 — 일할 X (기존 그대로)

**[F3] 정산 로직 — 일할 계산 적용**
- 입사 첫 달: `amount × (실제 근무 가능 일수 / 그 달의 총일수)`
  - 실제 근무 가능 일수 = (말일 - 입사일 + 1)
- 퇴사 달: `amount × ((퇴사일 - 1일) + 1) / 총일수`
- 중간 달: `amount` 그대로
- 입사 + 퇴사 같은 달: `amount × (퇴사일 - 입사일 + 1) / 총일수`
- 일할 후 금액은 **반올림** (1원 단위)

**[F4] 정산 영수증에 일할 계산 사유 표시**
- 정산 화면 공제 줄에 일할 계산이 적용된 경우 보조 텍스트:
  - `숙소비   38,710원   (월 80,000원 × 15/31일, 5/17 입사)`
- 매달 정액인 경우 그대로 표시

**[F5] WorkerSettings 폼에 일할 옵션 UI**
- 고정 공제 각 행에 체크박스 "일할 계산"
- 변동 공제는 일할 옵션 없음 (지금처럼 매달 입력)
- 신규 추가 시 default 일할 ON

### Non-Functional Goals

- 기존 데이터 호환: 마이그레이션 적용 시 모든 기존 deduction 의 `prorate=true` 기본값
- 퇴사일 nullable — 기존 일꾼 영향 없음
- 정산 영수증 보조 텍스트는 한국어 + 영어 + 일본어 + 중국어 i18n 지원
  (이미 worker-payroll 모듈은 다국어 — 사용자 메모리에 명시)
- 백엔드 정산 함수 단일 진입점(`computeReceipt`) 에서 처리해 모든 호출 동일하게 적용

### Out of Scope

- 시간 단위 일할 (시급 차감) — 본 작업은 공제 항목만
- 시간 단위 입사·퇴사 (예: 5/17 오후 입사) — 일 단위만
- 정산 후 소급 조정 (이미 정산된 월 재계산) — 별도 작업
- 4대보험 자동 계산 (요율 적용) — 변동 공제로 입력
- 공제 일별 일할 계산 비율 표 변경 (예: "주 5일 근무 → 30/31일이 아닌 22/31일") — 단순 평일/주말 비율은 미고려, 그냥 달력일 기준

---

## 3. 사용자 시나리오

### S1. 일꾼 입사 첫 달 정산 (5/17 입사)

1. 사용자가 일꾼 등록: 이름 "홍길동", 입사일 2026-05-17, 숙소비 80,000원 (일할 ON), 4대보험 65,000원 (일할 OFF)
2. 5월 정산: 자동으로
   - 숙소비: 80,000 × 15/31 = **38,710원** (15일분)
   - 4대보험: **65,000원** (월 그대로)
3. 정산 영수증에 "숙소비 — 월 80,000원 × 15/31일 (5/17 입사)" 표시

### S2. 일꾼 퇴사 달 정산 (8/12 퇴사)

1. 사용자가 일꾼 정보 편집: 퇴사일 2026-08-12
2. 8월 정산: 자동으로
   - 숙소비: 80,000 × 12/31 = **30,968원** (1~12일분)
   - 4대보험: **65,000원** (월 그대로)
3. 정산 영수증에 "숙소비 — 월 80,000원 × 12/31일 (8/12 퇴사)" 표시
4. 8월 정산 후 그 일꾼은 정산 이력 / 목록에서 "퇴사" 배지 표시

### S3. 중간 달 (6월)

1. 입사 5/17, 6월 정산 시
2. 6월은 중간 달 → 숙소비 80,000원 그대로

### S4. 같은 달 입사 + 퇴사 (5/17 입사, 5/25 퇴사)

1. 숙소비: 80,000 × 9/31 = **23,226원** (5/17~25, 9일분)
2. 정산 영수증에 "숙소비 — 월 80,000원 × 9/31일 (5/17 입사, 5/25 퇴사)" 표시

### S5. 일할 계산 OFF 항목

1. 4대보험은 회사 정책상 일할 적용 X
2. 어떤 달에 입사·퇴사해도 65,000원 그대로

---

## 4. 영향 범위

| 모듈 | 변경 유형 |
|------|----------|
| `backend/database/migrations/035_worker_end_date_proration.sql` | 신규 — payroll_workers.end_date, payroll_worker_deductions.prorate |
| `backend/src/modules/worker-payroll/entities/worker.entity.ts` | endDate 추가 |
| `backend/src/modules/worker-payroll/entities/worker-deduction.entity.ts` | prorate boolean 추가 |
| `backend/src/modules/worker-payroll/dto/worker.dto.ts` | endDate, prorate validation |
| `backend/src/modules/worker-payroll/worker-payroll.service.ts` | computeReceipt 안에서 일할 계산 + endDate 보호로직 |
| `frontend/src/modules/worker-payroll/types/worker-payroll.types.ts` | endDate, prorate 필드 |
| `frontend/src/modules/worker-payroll/api/worker-payroll.api.ts` | 저장 페이로드 |
| `frontend/src/modules/worker-payroll/components/WorkerSettings.vue` | 퇴사일 입력 + 고정공제 행에 일할 체크박스 |
| `frontend/src/modules/worker-payroll/components/WorkerSettlement.vue` | 영수증 공제 행에 일할 계산 사유 |
| `frontend/src/modules/worker-payroll/i18n/*.ts` | "퇴사일", "일할 계산", "월 ~~원 × N/총일수일" 다국어 |
| `frontend/src/modules/worker-payroll/components/WorkerCalendar.vue` | 퇴사일 이후 셀 비활성/회색 처리 |
| `WorkerPayrollView` 목록 | 퇴사 배지 |

---

## 5. 데이터 모델 변경

### 5.1 payroll_workers
- `end_date DATE NULL` 추가
  - NULL = 재직 중
  - 값 있으면 = 퇴사일 (그 날까지 근무, 다음날부터 제외)

### 5.2 payroll_worker_deductions
- `prorate BOOLEAN NOT NULL DEFAULT TRUE` 추가
  - true = 입사·퇴사 달에 일할 계산
  - false = 매달 정액

### 5.3 호환성
- 기존 deduction 들은 default `prorate=true` — 다음 입사·퇴사 달에 자동 일할 적용
- 기존 workers 의 `end_date=NULL` — 영향 없음

---

## 6. 정산 로직 (백엔드 의사코드)

```typescript
function computeProratedAmount(
  baseAmount: number,
  prorate: boolean,
  periodStart: string,         // 정산 기간 시작 (= 그 달 1일 or 입사일)
  periodEnd: string,           // 정산 기간 끝 (= 그 달 말일 or 퇴사일)
  worker: { startDate, endDate },
): { amount: number, prorationReason?: string }

{
  if (!prorate) return { amount: baseAmount }

  // 그 달의 총일수
  const monthStart = 그 달 1일
  const monthEnd   = 그 달 말일
  const monthDays  = monthEnd.day - monthStart.day + 1

  // 실제 근무 가능 일수
  const effStart = max(worker.startDate, monthStart)
  const effEnd   = min(worker.endDate ?? monthEnd, monthEnd)
  const effDays  = effEnd.day - effStart.day + 1

  if (effDays >= monthDays) return { amount: baseAmount }  // 중간 달

  const prorated = Math.round(baseAmount * effDays / monthDays)

  let reason = `월 ${baseAmount.toLocaleString()}원 × ${effDays}/${monthDays}일`
  if (effStart > monthStart) reason += ` (${effStart.month}/${effStart.day} 입사)`
  if (effEnd < monthEnd)     reason += ` (${effEnd.month}/${effEnd.day} 퇴사)`

  return { amount: prorated, prorationReason: reason }
}
```

`computeReceipt` 안의 deductions.map 에서 호출.

### 6.1 endDate 보호로직
- `computeReceipt` 의 working-day loop 에서 `cursor > worker.endDate` 인 날은 근무일/시간 계산 제외
- `getCalendar` 도 동일 — 퇴사일 이후 셀은 status='terminated' 또는 그냥 표시 안 함

---

## 7. UI/UX

### 7.1 WorkerSettings 폼

```
② 근무조건
  ┌───────────────────────────────────────┐
  │ 시급        12,000원                   │
  │ 일 근무시간 8시간                       │
  │ 입사일      2026-05-17                  │
  │ 퇴사일      [   nullable date  ]  ⓘ    │
  │             비워두면 재직 중           │
  └───────────────────────────────────────┘

③ 공제 항목
  ┌─────────────────────────────────────────────────┐
  │ 고정 공제                                       │
  │  숙소비       80,000원   [✓] 일할 계산 ⓘ ─       │
  │  4대보험      65,000원   [ ] 일할 계산           │
  │  + 항목 추가                                     │
  │                                                  │
  │ ⓘ 일할 계산 ON 시 입사·퇴사 달에 자동으로        │
  │   사용일수 비율로 차감됩니다.                    │
  └─────────────────────────────────────────────────┘
```

### 7.2 WorkerSettlement (영수증)

```
공제 내역
  숙소비           38,710원
    월 80,000원 × 15/31일 (5/17 입사)
  4대보험          65,000원
  ────────────
  공제 합계       103,710원
```

### 7.3 WorkerCalendar (근무 달력)

- 입사일 전: 회색 + "입사 전" 라벨 (기존 그대로)
- 퇴사일 후: 회색 + **"퇴사 후"** 라벨 (신규)
- 퇴사일 당일: 정상 셀 (근무함)

### 7.4 다국어

| 키 | ko | en | ja | zh |
|---|---|---|---|---|
| endDate | 퇴사일 | End date | 退職日 | 离职日 |
| endDateHelp | 비워두면 재직 중 | Leave empty if still active | 空欄なら在職中 | 留空表示在职 |
| prorate | 일할 계산 | Prorate | 日割計算 | 按日计算 |
| prorateHint | 입사·퇴사 달은 사용일수 비율로 차감됩니다. | Prorated based on days worked in entry/exit months | 入退社月は使用日数比率で控除 | 入退职月按使用天数比例扣除 |
| prorationReason | 월 {amount}원 × {days}/{total}일 | {amount} × {days}/{total} days | 月{amount}円 × {days}/{total}日 | 月{amount}元 × {days}/{total}天 |
| entryDate | 입사 | entry | 入社 | 入职 |
| exitDate | 퇴사 | exit | 退社 | 离职 |
| terminated | 퇴사 후 | After exit | 退職後 | 离职后 |

---

## 8. 리스크 & 대응

| 리스크 | 대응 |
|--------|------|
| 기존 정산 이력의 deduction 금액 변경 위험 | 이미 settle 된 settlement 는 `worker_settlements.deductions_json` 에 스냅샷으로 저장됨 → 영향 없음 |
| 일할 계산이 잘못된 케이스에 적용 (4대보험 등) | 항목별 `prorate` 옵션으로 사용자가 직접 ON/OFF |
| 사용자가 퇴사일 잘못 입력 | 폼에서 endDate >= startDate 검증, 미래 날짜도 허용 (예약 퇴사) |
| 같은 달 입사+퇴사 케이스 | 6장 의사코드에서 두 사유 모두 표시 |
| 퇴사 후 정산을 안 한 일꾼 | 마지막 정산일까지의 정산 이력 그대로 유지, 일꾼 카드에 "퇴사 (YYYY-MM-DD)" 배지 |
| 일할 후 반올림 오차 | Math.round (1원 단위) — 1원 이내 오차는 수용 |

---

## 9. 성공 기준

- [ ] 마이그레이션 적용 후 기존 일꾼·공제 영향 0
- [ ] WorkerSettings 폼에 퇴사일 입력란 + 폼 검증
- [ ] WorkerSettings 폼의 고정 공제 행에 "일할 계산" 체크박스
- [ ] 입사 첫 달 정산 시 일할 ON 항목 비율 계산
- [ ] 퇴사 달 정산 시 일할 ON 항목 비율 계산
- [ ] 같은 달 입사+퇴사 시 두 사유 모두 표시
- [ ] 일할 OFF 항목은 매달 정액 유지
- [ ] WorkerCalendar 의 퇴사 후 일자 비활성 표시
- [ ] 정산 영수증의 일할 계산 사유 표시 + 4개국어
- [ ] 이미 정산된 settlement 의 금액 변경 없음 (스냅샷)
- [ ] vue-tsc / nest build 통과

---

## 10. PDCA 다음

→ `/pdca design worker-deduction-proration` — 구체 구현 명세 (마이그레이션 SQL, 정산 함수 시그니처, UI 와이어프레임 정밀, i18n key 표)
