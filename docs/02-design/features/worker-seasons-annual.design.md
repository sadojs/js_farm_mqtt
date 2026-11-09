# 일꾼관리 — 시즌(근무 기간) 도입 + 연간 결산 · 구현 지시서

> **Claude CLI 용 실행 문서.** 이 파일을 처음부터 끝까지 읽고 "진행 순서"대로 구현·테스트한다.
> 작성: 2026-11-09 (Cowork 세션에서 코드 분석 후 작성). 디자인 시안은 사용자의 Claude 캔버스에 있음(이 문서의 §6 이 텍스트 사양).
> 각 Phase 끝의 **완료 조건**을 만족해야 다음 Phase 로 넘어간다. 애매하면 추측하지 말고 사용자에게 질문.

---

## 0. 배경 / 해결할 문제

- 외국인 계절근로자가 2026 농사 종료 후 귀국. **2027년에 같은 사람이 다시 입국**해 근무 예정.
- 요구: ① 과거 기록(달력·가불·공제·정산)은 **절대 삭제·변형되지 않을 것** ② 같은 일꾼을 재고용 ③ **연도별 총 인건비 합계** 페이지.

### 현재 구조의 한계 (backend/src/modules/worker-payroll)

`payroll_workers` 한 행에 `start_date / end_date / hourly_wage / fixed_monthly_salary / daily_hours / salary_type / settlement_cycle_type` 이 **한 벌만** 있음.

1. 재입국 시 `start_date` 를 2027 로 바꾸면 `computeReceipt`·`getCalendar`·`prorateAmount`·`resolvePeriod` 가 2027 이전 날짜를 전부 "근무 전(beforeStart)" 으로 처리 → **미확정 2026 기간이 0원으로 재계산**, 달력도 비어 보임.
2. 시급·공제(`payroll_deductions`, worker 단위)를 바꾸면 **미확정 과거 기간이 새 값으로 재계산**됨. (확정된 정산은 `payroll_settlements.snapshot` 에 박제되어 안전)
3. 새 일꾼으로 재등록하면 farm_user 로그인 계정이 둘로 갈리고 사람 단위 이력이 끊김.

→ **결론: "년도 컬럼" 이 아니라 "시즌(고용 기간)" 엔티티를 도입한다.** 일꾼 = 사람(계정·연락처), 시즌 = 한 번의 고용(기간·임금 조건·공제).

---

## 1. 핵심 설계 결정 (변경 금지 — 바꾸려면 사용자 확인)

| # | 결정 |
|---|------|
| D1 | 신규 테이블 `payroll_worker_seasons`. 근무조건(기간·임금·정산주기·기본시간)은 시즌이 가진다. |
| D2 | `payroll_workers` 의 기존 근무조건 컬럼은 **삭제하지 않고 "현재 시즌 미러"** 로 유지. 시즌 저장 시 현재 시즌 값으로 동기화. → 구버전 모바일 앱 번들(`mobile/www`, Capacitor 에 이전 빌드가 들어있음)·`WorkerSelfView`·`/worker-payroll/me` 가 그대로 동작. |
| D3 | 계산 로직은 갈아엎지 않는다. `effectiveWorker(worker, season)` = worker 를 얕은 복사 후 시즌 값으로 덮어쓴 객체를 만들어 **기존 `resolvePeriod / computeReceipt / prorateAmount / getCalendar` 에 그대로 넘긴다.** |
| D4 | 공제(`payroll_deductions`)에 `season_id` 추가 → 시즌별 공제. 가불·일자조정·정산은 **날짜로 시즌에 귀속**(컬럼 추가 없음). |
| D5 | **지연 백필(lazy ensure)**: 시즌이 0개인 일꾼은 조회 시점에 worker 컬럼으로 시즌 1개를 자동 생성하고 `season_id IS NULL` 공제를 거기에 연결. (테스트 DB 는 synchronize + seed 가 `payroll_workers` 만 넣으므로 필수. SQL 마이그레이션도 같은 백필을 수행 — 둘 다 idempotent.) |
| D6 | **시즌 마감(closed_at)**: 시즌 내 모든 정산기간이 `confirmed` 여야 마감 가능. 마감된 시즌의 날짜에 대한 `setDay / addAdvance / removeAdvance / requestSettlement / approveSettlement / 공제 수정` 은 409 `SEASON_CLOSED`. 마감 해제 가능(관리자). |
| D7 | 같은 일꾼의 시즌 기간은 **겹치면 안 됨**. 새 시즌 생성 시 직전 시즌에 `end_date` 가 없으면 400 `PREVIOUS_SEASON_OPEN`. |
| D8 | API 하위호환: `seasonId` 파라미터가 없으면 **기본 시즌** = 오늘을 포함하는 시즌 → 없으면 시작일이 가장 최근인 시즌. 응답은 필드 **추가만** 한다(기존 필드 제거·의미변경 금지). |
| D9 | 연간 결산은 **확정(confirmed) 정산 snapshot 만** 합산. 연도 귀속 = `period_end` 의 연도, 월 귀속 = `period_end` 의 월. 미확정분은 `estimated` 로 별도 표시. |
| D10 | DB 스키마는 additive 만(컬럼 DROP 금지). 롤백 = 코드 revert, 신규 테이블/컬럼은 남아도 무해. |

---

## 2. 데이터 모델

### 2.1 마이그레이션 `backend/database/migrations/055_worker_seasons.sql`

> 번호는 작업 시점 마지막 번호 +1 로 (현재 마지막: `054_work_types_seeded_marker.sql`). 반드시 **idempotent** (`IF NOT EXISTS`, `ON CONFLICT`, `WHERE NOT EXISTS`).

```sql
-- 055_worker_seasons.sql — 일꾼 시즌(고용 기간) 도입. additive only.
CREATE TABLE IF NOT EXISTS payroll_worker_seasons (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL,              -- 농장 소유자 (소프트 참조)
  worker_id              UUID NOT NULL,
  season_year            INT  NOT NULL,              -- 표시용 = start_date 의 연도
  start_date             DATE NOT NULL,
  end_date               DATE NULL,                  -- NULL = 근무 중
  salary_type            VARCHAR(20) NOT NULL DEFAULT 'hourly',
  hourly_wage            INT NOT NULL DEFAULT 0,
  fixed_monthly_salary   INT NOT NULL DEFAULT 0,
  daily_hours            NUMERIC(4,1) NOT NULL DEFAULT 8,
  settlement_cycle_type  VARCHAR(20) NOT NULL DEFAULT 'calendar_month',
  note                   VARCHAR(120) NULL,
  closed_at              TIMESTAMPTZ NULL,           -- 시즌 마감 시각 (NULL = 열림)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_seasons_worker ON payroll_worker_seasons(worker_id, start_date);
CREATE INDEX IF NOT EXISTS idx_payroll_seasons_user_year ON payroll_worker_seasons(user_id, season_year);

ALTER TABLE payroll_deductions ADD COLUMN IF NOT EXISTS season_id UUID NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_season ON payroll_deductions(season_id);

-- 백필: 시즌이 없는 일꾼마다 현재 컬럼으로 시즌 1개 생성 (is_active=false 인 일꾼 포함 — 기록 보존 목적)
INSERT INTO payroll_worker_seasons
  (user_id, worker_id, season_year, start_date, end_date, salary_type, hourly_wage,
   fixed_monthly_salary, daily_hours, settlement_cycle_type)
SELECT w.user_id, w.id, EXTRACT(YEAR FROM w.start_date)::int, w.start_date, w.end_date,
       w.salary_type, w.hourly_wage, w.fixed_monthly_salary, w.daily_hours, w.settlement_cycle_type
FROM payroll_workers w
WHERE NOT EXISTS (SELECT 1 FROM payroll_worker_seasons s WHERE s.worker_id = w.id);

-- 백필: 기존 공제를 그 일꾼의 (유일한) 시즌에 연결
UPDATE payroll_deductions d
SET season_id = s.id
FROM payroll_worker_seasons s
WHERE d.season_id IS NULL AND s.worker_id = d.worker_id
  AND s.id = (SELECT s2.id FROM payroll_worker_seasons s2 WHERE s2.worker_id = d.worker_id
              ORDER BY s2.start_date DESC LIMIT 1);
```

(Phase 4 선택 기능용 `payroll_extra_costs` 는 §5.4 참고 — 별도 마이그레이션 056.)

### 2.2 엔티티

- 신규 `entities/worker-season.entity.ts` → `WorkerSeason` (`@Entity('payroll_worker_seasons')`, 위 컬럼 camelCase 매핑, decimal 은 기존 `Worker.dailyHours` 와 같은 방식).
- `WorkerDeduction` 에 `@Column({ name: 'season_id', type: 'uuid', nullable: true }) seasonId: string | null;`
- `worker-payroll.module.ts` 의 `TypeOrmModule.forFeature([...])` 에 `WorkerSeason` 추가.
- **`backend/test/utils/seed.ts` 37~38행 근처의 테이블 정리 목록에 `payroll_worker_seasons` 추가** (빠뜨리면 테스트 간 데이터 누수).

---

## 3. 백엔드 변경 (worker-payroll.service.ts / controller / dto)

### 3.1 시즌 헬퍼 (service 내부 private)

```ts
private async ensureSeasons(worker: Worker): Promise<WorkerSeason[]>
  // 시즌 0개면 worker 컬럼으로 1개 생성 + season_id NULL 공제 연결 (D5). start_date ASC 반환.
private pickDefaultSeason(seasons, today = todayStr()): WorkerSeason   // D8
private seasonForDate(seasons, date): WorkerSeason | null              // start<=date<=coalesce(end,∞)
private effectiveWorker(worker, season): Worker                         // D3: {...worker, startDate, endDate, salaryType, hourlyWage, fixedMonthlySalary, dailyHours, settlementCycleType}
private assertSeasonOpen(season)                                        // closed_at 있으면 ConflictException({code:'SEASON_CLOSED'})
private async syncMirror(worker, seasons)                               // D2: 기본 시즌 값을 payroll_workers 컬럼에 복사 + is_active=true 유지
```

- `date` 컬럼은 문자열 비교 전에 항상 `.slice(0,10)` (기존 코드 관례 따름).
- 기간 비교는 기존 유틸(`parseDate / fmt / addDays / daysBetween / todayStr`)만 사용. TZ 는 Asia/Seoul.

### 3.2 기존 메서드 수정

| 메서드 | 변경 |
|--------|------|
| `getCalendar(user, workerId, periodStart?, seasonId?)` | 시즌 결정: `seasonId` → 지정 / `periodStart` → 그 날짜의 시즌 / 둘 다 없음 → 기본 시즌. `effectiveWorker` 로 기존 로직 실행. 응답에 `season: {id, seasonYear, startDate, endDate, closed}` 추가. |
| `resolvePeriod(worker, periodStart?)` | 시그니처 유지(effectiveWorker 를 받으므로 시즌 시작일로 clamp 됨). **추가**: 시즌 `endDate` 가 있으면 마지막 기간(=endDate 를 포함하는 기간) 이후로 넘어가지 않게 clamp, `nextPeriodStart` 는 마지막 기간이면 `null`. 오늘 이후 미래 기간도 기존과 동일하게 허용. |
| `computeReceipt` | 공제 조회를 `where: { workerId, seasonId: season.id }` 로. (worker 인자는 effectiveWorker) |
| `getSettlement / requestSettlement / approveSettlement` | 위와 같은 시즌 결정. request/approve 는 `assertSeasonOpen`. 응답에 `season` 추가. **snapshot 에 `seasonId`, `seasonYear` 포함**(연간 결산·이력 필터용). |
| `setDay` | `seasonForDate(dto.date)` 없으면 400 `DATE_OUTSIDE_SEASON`, 있으면 `assertSeasonOpen`. 기본시간 비교는 그 시즌의 `dailyHours`. |
| `addAdvance / removeAdvance` | 가불 날짜의 시즌 확인 + `assertSeasonOpen`. 시즌 밖 날짜 → 400 `DATE_OUTSIDE_SEASON`. |
| `saveWorker(ownerId, dto)` | 신규 등록: 기존대로 worker 생성 + **첫 시즌 생성**(dto 근무조건) + 공제는 그 시즌으로. 수정: `dto.seasonId` 있으면 그 시즌, 없으면 기본 시즌을 수정(구 클라이언트 호환). 근무조건·공제는 **시즌에** 저장 후 `syncMirror`. 이름·연락처는 worker 에. 마감된 시즌 수정 → 409. |
| `replaceDeductions` | 시즌 단위로 교체 (`seasonId` 인자 추가). |
| `listWorkers(ownerId, year?)` | 응답 각 항목에 `seasons: SeasonBrief[]`, `currentSeason`, `lastSeasonYear` 추가. `year` 가 오면 `inYear: boolean`(그 해와 겹치는 시즌 존재) 추가. 기존 필터(`isActive: true`) 유지. |
| `getWorker` | `seasons` 포함. |
| `listSettlements(ownerId, year?)` | `year` 주어지면 `period_end` 연도로 필터. 항목에 `seasonYear` (snapshot 에 없으면 period 로 역산) 추가. |
| `removeWorker` | 변경 없음(soft delete). |
| `getMyWorker` | 변경 최소: 반환 worker 는 미러 값이라 그대로 동작. 가능하면 `currentSeason` 추가. |

### 3.3 신규 엔드포인트 (controller — 기존 라우트와 같은 가드/권한 패턴 사용: `@UseGuards(JwtAuthGuard)` + 서비스의 `findOwnedWorker(ownerId)`/`isManager` 체크. 농장 단위 기능이므로 `@PlatformScope()` **붙이지 않음**. `X-Farm-Context` 에서도 동작해야 함)

| Method | Path | Body / Query | 동작 |
|--------|------|--------------|------|
| GET | `/worker-payroll/workers/:id/seasons` | — | 시즌 목록 + 시즌별 요약(근무일·시간·확정 지급액·미확정 건수) |
| POST | `/worker-payroll/workers/:id/seasons` | `CreateSeasonDto { startDate, endDate?, salaryType?, hourlyWage, fixedMonthlySalary?, dailyHours, settlementCycleType?, note?, copyDeductionsFromSeasonId?, deductions?: DeductionInputDto[] }` | **재고용**. D7 검증(겹침/직전 시즌 열림). `deductions` 우선, 없으면 `copyDeductionsFromSeasonId` 공제를 복사(새 id). worker `is_active=true` 로 복구. farm_user 계정이 비활성화되어 있으면 다시 활성화(UsersService 에 해당 기능이 있는지 먼저 확인, 없으면 TODO 로 남기고 사용자에게 보고). `syncMirror`. |
| PUT | `/worker-payroll/seasons/:seasonId` | `UpdateSeasonDto` (부분) | 시즌 조건 수정. 마감 시 409. 겹침 검증. 기간 축소로 이미 확정된 정산기간이 시즌 밖이 되면 409 `SETTLED_PERIOD_OUTSIDE`. |
| POST | `/worker-payroll/seasons/:seasonId/close` | — | D6. `end_date` 없으면 400 `SEASON_NOT_ENDED`. 시즌 내 모든 정산기간(시작~종료 기간을 `resolvePeriod` 로 순회)에 confirmed 행이 없으면 409 `SEASON_UNSETTLED` + `{ periods: [{periodStart, settleDate, status}] }`. 성공 시 `closed_at=now()`. activity-log 기록(기존 패턴 있으면 따름). |
| POST | `/worker-payroll/seasons/:seasonId/reopen` | — | 관리자만. `closed_at=null`. |
| GET | `/worker-payroll/annual` | `?year=2026` (필수, 4자리) | §3.4 |

DTO 는 `dto/season.dto.ts` 에 class-validator 로 (기존 `worker.dto.ts` 스타일). 날짜 `@IsDateString()`, 금액 `@IsInt() @Min(0)`, `dailyHours` 0.5 단위.

### 3.4 연간 결산 `GET /worker-payroll/annual?year=YYYY`

집계 원천: `payroll_settlements` (userId=owner, `status='confirmed'`, `EXTRACT(YEAR FROM period_end)=year`). snapshot 필드: `grossPay, deductionTotal, advanceTotal, netPay, workDays, totalHours, deductions[]`. 구버전 snapshot 에 `advanceTotal` 이 없으면 `grossPay - deductionTotal - netPay` 로 역산(프론트 `SettlementHistory.advOf` 와 동일 규칙 — 공용 함수로 뽑을 것).

응답:
```ts
{
  year: number,
  totals: { grossPay, deductionTotal, advanceTotal, netPay, cashOut /* netPay+advanceTotal */, workDays, totalHours, headcount, extraCostTotal /* Phase4 전엔 0 */, totalCost /* grossPay + extraCostTotal */ },
  monthly: Array<{ month: 1..12, grossPay, deductionTotal, advanceTotal, netPay }>,   // 12개 고정, 없는 달 0
  byWorker: Array<{ workerId, workerName, seasonYear, seasonStart, seasonEnd, workDays, totalHours, grossPay, deductionTotal, advanceTotal, netPay, share /* grossPay 비중 0~1 */ }>,
  deductionsByLabel: Array<{ label, amount }>,     // 숙소비/식비/보험 등 항목별 회수액
  unsettled: { count, estimatedNetPay, items: Array<{ workerId, workerName, periodStart, settleDate, status: 'open'|'pending'|'requested', estimatedNetPay }> },
  previousYear: { year, grossPay, netPay, headcount } | null,
}
```
- `unsettled`: 그 해와 겹치는 시즌들의 정산기간 중 confirmed 가 아닌 것. 금액은 `computeReceipt` 로 계산(변동공제 0). 기간 순회 상한 24개/시즌(무한루프 방지).
- `headcount` = confirmed 정산이 1건 이상인 서로 다른 workerId 수.
- 삭제(is_active=false)된 일꾼의 정산도 **포함**(이름은 `nameMap` 처럼 전체 worker 에서 조회).
- 성능: 농장당 수십 건 수준이라 메모리 집계로 충분. 필요 시 SQL 집계.

---

## 4. 프론트엔드 변경 (frontend/src/modules/worker-payroll)

### 4.1 타입/API
- `types/worker-payroll.types.ts`: `WorkerSeason`, `SeasonBrief`, `AnnualReport` 추가. `Worker` 에 `seasons?`, `currentSeason?`, `lastSeasonYear?` (optional — 하위호환).
- `api/worker-payroll.api.ts`: `listWorkers(year?)`, `listSeasons(workerId)`, `createSeason(workerId, dto)`, `updateSeason(id, dto)`, `closeSeason(id)`, `reopenSeason(id)`, `getAnnual(year)`, 기존 `getCalendar/getSettlement/...` 에 optional `seasonId` 파라미터. `listSettlements(year?)`.

### 4.2 화면 (§6 시안 사양 참고)
1. **`WorkerPayrollView.vue`**
   - 헤더 우측에 **연도 세그먼트**(데이터가 있는 연도 + 다음 연도). 기본값 = 올해. 선택 연도는 `localStorage` 키 `payroll.year` 에 기억(try/catch).
   - 모드 탭에 **`연간 결산`** 추가 → `mode: 'workers' | 'history' | 'annual'`.
   - 좌측 목록을 2그룹: "{year} 시즌 일꾼 · N명"(`inYear`) / "지난 시즌 일꾼 · 이번 시즌 미고용"(그 외). 지난 그룹 항목에 **[재고용]** 버튼 → `RehireModal`.
   - 배지: 귀국(시즌 end_date 있음) `귀국 MM/DD`, 미확정 정산 있으면 `정산 N건 남음`, 마감 시 `마감`.
2. **신규 `components/SeasonHeader.vue`** (선택 일꾼 상단 카드): 이름/아이디/첫 고용연도, **시즌 칩**(연도·기간, 클릭 시 해당 시즌으로 달력·정산 전환), `+ {다음연도} 시즌 시작` 칩, 시즌 요약 4칸(근무일수·총시간·지급액·실수령), 마감 상태 배지 + `시즌 마감`/`마감 해제` 버튼. 마감 실패(409 SEASON_UNSETTLED) 시 남은 기간 목록 표시.
3. `WorkerCalendar.vue` / `WorkerSettlement.vue`: `seasonId` prop 추가 → API 에 전달. 마감 시즌이면 편집 UI 비활성 + 잠금 안내 문구. 정산 탭 하단에 **시즌 합계 행**.
4. `WorkerSettings.vue`: 편집 대상이 "선택 시즌의 근무조건" 임을 표시(“2026 시즌 조건”). 마감 시즌이면 읽기 전용. 신규 등록 흐름은 그대로(첫 시즌 자동 생성).
5. **신규 `components/RehireModal.vue`**: 입국일, 예정 귀국일(선택), 시급(지난 시즌 값 프리필 + "지난 시즌 N원 · 최저임금 확인" 안내), 하루 기본시간, 지난 시즌 공제 체크리스트(복사 여부·금액 수정), 안내문 "지난 시즌 기록은 바뀌지 않음". 제출 → `createSeason` → 목록 새로고침 → 해당 일꾼/새 시즌 선택.
6. **신규 `components/AnnualReport.vue`** (연간 결산 탭):
   - KPI 카드: 총 고용비용(강조) / 급여 총액(세전) / 공제 회수 / 실제 지급(실수령+가불) / 인원·근무시간(+평균 시간당 비용 = grossPay/totalHours).
   - 미확정 안내: `unsettled.count > 0` 이면 "미확정 N건(예상 실수령 X원) 별도" 배너.
   - **월별 인건비 누적 막대**(Chart.js + vue-chartjs, 프로젝트 기존 사용 라이브러리): 실수령/공제/가불 stack, 1~12월.
   - 일꾼별 합계 표(근무기간·일수·시간·급여·공제·실수령·비중 막대) + 합계 행. 모바일에서 가로 스크롤 박스.
   - 공제 항목별 회수액 리스트.
   - 연도 비교(전년 급여총액·인원·증감).
   - **엑셀 내려받기**: 의존성 추가 없이 **CSV(UTF-8 BOM, 엑셀 한글 깨짐 방지)** 로 3개 섹션(요약/월별/일꾼별) 생성. `xlsx` 패키지 추가는 사용자 승인 후.
7. `SettlementHistory.vue`: 상단 연도 필터 연동(`listSettlements(year)`), `advOf` 는 공용 util 로 이동.
8. i18n(`i18n/payroll-i18n`): 일꾼 본인 화면(WorkerSelfView)에 노출되는 신규 문구만 다국어 키 추가. 관리자 전용 화면은 기존처럼 한국어.
9. `WorkerSelfView.vue`: 기본 시즌 기준으로 동작(백엔드 기본값이 처리). 시즌 칩으로 지난 시즌 열람 가능하면 좋음(읽기 전용) — 여유 있으면.

### 4.3 스타일
기존 토큰(`--accent`, `--bg-card`, `--border-card`, `--text-muted` …)과 기존 컴포넌트 클래스 패턴을 그대로 사용. 새 색 하드코딩 금지(차트 색은 `--accent` 계열에서 파생). 768px 이하 레이아웃은 기존 `.layout` 미디어쿼리 방식.

---

## 5. 진행 순서 (Phase)

### Phase 0 — 준비
1. `git status` 확인. 작업과 무관한 미커밋 변경(`.bkit/`, `docs/.pdca-snapshots/`, `.claude/agent-memory/` 등)이 있으면 **사용자에게 처리 방법 질문**(커밋/스태시/무시). 임의로 삭제·커밋 금지.
2. `git checkout -b feat/worker-seasons`
3. `docs/01-plan/features/worker-seasons-annual.plan.md` 가 필요하면 기존 plan 문서 형식으로 이 문서를 요약해 생성(선택).

### Phase 1 — DB + 백엔드 시즌 코어
1. 마이그레이션 055, `WorkerSeason` 엔티티, `WorkerDeduction.seasonId`, module 등록, seed 테이블 목록 추가.
2. §3.1 헬퍼, §3.2 수정, §3.3 중 seasons CRUD/close/reopen.
3. `cd backend && npx tsc --noEmit -p tsconfig.json` 통과.
4. 테스트 `backend/test/worker-seasons.spec.ts` 작성(§7) → `npm test` 전체 통과(기존 스펙 회귀 포함, 특히 `regression-no-header.spec.ts`, `farm-context-http.spec.ts`, `permissions.spec.ts`).

**완료 조건**: tsc 0 error, `npm test` 전부 green, 기존 API 응답 필드 변경 없음(추가만).

### Phase 2 — 연간 결산 API
1. `GET /worker-payroll/annual`, `listSettlements(year)`.
2. 테스트 추가(§7 A-*). `npm test` green.

### Phase 3 — 프론트엔드
1. §4.1 → §4.2 순서: 타입/API → View 연도·탭 → SeasonHeader → Calendar/Settlement seasonId → Settings → RehireModal → AnnualReport → SettlementHistory.
2. `cd frontend && npm run build` (vue-tsc 포함) 통과.
3. 로컬 실행 확인(§8) — 사용자에게 화면 확인 요청.

### Phase 4 — (선택, 사용자 승인 후) 기타 고용비용
- 마이그레이션 056: `payroll_extra_costs (id uuid pk, user_id uuid, year int, date date null, worker_id uuid null, label varchar(60), amount int, note varchar(120) null, created_at, updated_at)` + index(user_id, year).
- CRUD `GET/POST/PUT/DELETE /worker-payroll/extra-costs?year=` + annual 의 `extraCostTotal/totalCost` 반영 + AnnualReport 카드(항공권·비자/수수료·숙소 관리/공과금·보험 농장부담분 프리셋 라벨).

### Phase 5 — 문서/마무리
1. **CLAUDE.md 업데이트**: Backend Structure 의 `worker-payroll/` 항목 추가 설명(시즌 모델, 미러 규칙 D2, 마감 규칙 D6, annual API), Key Files 에 이 문서 경로 추가.
2. 이 문서 하단 "변경 기록"에 실제 구현과 달라진 점 기록.
3. 커밋은 Phase 단위로 나눠 제안(사용자 승인 후 커밋). 배포는 CLAUDE.md "배포 절차" 를 따르고 **운영 DB 에 `npm run migrate -- --dry` 로 먼저 확인** 후 적용.

---

## 6. 화면 사양 (디자인 시안 텍스트판)

**① 일꾼별 근무·정산**
- 헤더: `일꾼 관리` / 우측 `시즌 [2025][2026][2027 +]` 세그먼트.
- 탭: `일꾼별 근무·정산 | 정산 이력 | 연간 결산(NEW)`.
- 좌측: `2026 시즌 일꾼 · 3명` (아바타·이름·배지 `귀국 11/02`/`정산 1건 남음`, 보조줄 `2년차 · 3/20 ~ 11/02`) → 구분선 → `지난 시즌 일꾼 · 이번 시즌 미고용` (회색 아바타, `마지막 근무 2025 시즌`, [재고용]) → `+ 새 일꾼 등록`.
- 우측 상단 카드: 이름·@아이디·`첫 고용 2025`, 우측 배지 `2026 시즌 마감 완료 · 기록 잠금`; 시즌 칩 `2025 시즌 4/01~11/15`, `2026 시즌 3/20~11/02`(선택), `+ 2027 시즌 시작`; 요약 4칸(근무 일수/총 근무시간/시즌 지급액(세전)/시즌 실수령 합계).
- 하위 탭 `근무 달력 | 월 정산 | 근무·임금`. 월 정산 표 하단 `2026 시즌 합계` 행. 입국/귀국 달은 `(입국 일할)`/`(귀국 일할)` 표시.
- 마감 시 노란 안내: "시즌을 마감하면 이 시즌의 달력·가불·정산은 수정할 수 없고, 다음 시즌에서 시급·공제를 바꿔도 지난 기록은 그대로 남습니다." + [마감 해제].

**② 연간 결산**
- 제목 `2026년 인건비 결산` / 우측 "확정된 정산 기준 · 미확정 N건" + [엑셀 내려받기].
- KPI 5칸(첫 칸 강조색: 총 고용비용, 전년 대비 ±%).
- 월별 인건비 누적 막대(실수령·공제·가불 범례).
- 2단: 일꾼별 합계 표(좌, 넓게) / 기타 고용비용 카드(우, Phase 4 전에는 "준비 중" 또는 숨김).
- 하단 연도 비교 한 줄.

**③ 재고용 모달** — `일꾼 A · 2027 시즌 시작`, "계정·연락처는 그대로 쓰고, 지난 시즌 조건을 불러왔어요." / 입국일·예정 귀국일 / 시급(주황 테두리 강조 + 지난 시즌 값 안내)·하루 기본 근무 / 고정 공제 체크리스트 / 녹색 안내 "2026 시즌 기록은 바뀌지 않아요. 새 조건은 2027-03-20부터만 적용" / [취소] [2027 시즌 시작].

---

## 7. 테스트 케이스 (`backend/test/worker-seasons.spec.ts`)

기존 스펙 패턴(`createTestApp`, `seed`, `USERS`, `tokenFor`, supertest, `/api/...` prefix)을 따른다. `todayStr()` 이 실제 날짜이므로 **과거 날짜(2025~2026 초) 시즌**으로 테스트해 정산일 경과 조건을 만족시킨다.

- S1 레거시 일꾼(seed 의 payroll_workers, 시즌 없음) 조회 시 시즌 1개 자동 생성, 기존 공제가 그 시즌에 연결, 달력·정산 결과가 **도입 전과 동일**(금액 스냅샷 비교).
- S2 시즌A(2025-03-01~2025-10-31, 시급 10,000) 정산 2025-03 확정 → 시즌B(2026-03-01~, 시급 11,000) 생성 → 2025-03 정산 조회 결과 불변, 2025-04(미확정) 계산도 **10,000 기준** 유지.
- S3 시즌B 기간 중 `GET calendar` (파라미터 없음) → 시즌B 기본 선택. `seasonId=A` → 2025 달력.
- S4 겹치는 시즌 생성 → 400. 직전 시즌 end_date 없음 → 400 `PREVIOUS_SEASON_OPEN`.
- S5 시즌 밖 날짜 `setDay`/`addAdvance` → 400 `DATE_OUTSIDE_SEASON`.
- S6 미확정 기간 남은 상태 close → 409 `SEASON_UNSETTLED`(periods 포함). 전부 확정 후 close → 200. 마감 후 setDay/addAdvance/approve/공제수정 → 409 `SEASON_CLOSED`. reopen 후 다시 가능.
- S7 공제 복사: 재고용 시 `copyDeductionsFromSeasonId` → 새 id 로 복사, 원본 시즌 공제 불변.
- S8 미러(D2): 시즌B 생성 후 `GET /worker-payroll/workers` 의 `hourlyWage/startDate` 가 시즌B 값. `GET /worker-payroll/me`(일꾼 계정) 정상.
- S9 권한: 다른 농장(f2) 이 f1 일꾼 시즌 접근 → 404/403(기존 규칙과 동일). farm_user 가 season 생성/close → 403. admin + `X-Farm-Context: f1` → f1 으로 동작.
- A1 annual: confirmed 만 합산, `period_end` 연도 귀속, 12개월 배열, 구버전 snapshot(advanceTotal 없음) 역산.
- A2 annual: soft-delete 된 일꾼 포함, 다른 농장 데이터 미포함, `unsettled` 집계, `previousYear`.

---

## 8. 실행 / 검증 명령

```bash
# 백엔드 타입체크 & 테스트 (로컬 Postgres 필요: 기본 postgres://$USER@localhost:5432/sf_farmscope_test,
#   다르면 FARMSCOPE_TEST_DATABASE_URL 로 지정. DB 이름은 반드시 *_test)
cd backend
npx tsc --noEmit -p tsconfig.json
npm test                                   # 전체
npx jest test/worker-seasons.spec.ts       # 신규만

# 로컬 개발 DB 마이그레이션 (docker postgres 5433)
docker compose up -d postgres redis mosquitto
npm run migrate -- --dry && npm run migrate

# 실행
npm run start:dev                           # :3100
cd ../frontend && npm run dev               # vite
npm run build                               # vue-tsc 포함 빌드 검증
```

수동 확인 시나리오(사용자와 함께): 기존 2026 일꾼 → 시즌 칩 1개 보임 → 미확정 정산 확정 → 시즌 마감 → 연도 2027 선택 → "지난 시즌 일꾼" 에서 재고용 → 2027 시즌 생성 → 2026 시즌 칩 눌러 과거 달력·정산 그대로인지 확인 → 연간 결산 2026 합계가 정산 이력 합과 일치하는지 확인 → CSV 내려받아 엑셀에서 한글 확인.

---

## 9. 하지 말 것
- 기존 컬럼/테이블 DROP, 기존 응답 필드 제거·이름변경.
- 확정 snapshot 재계산·수정(마감 해제해도 confirmed 행은 그대로).
- 운영 DB 에 직접 쿼리/마이그레이션(사용자 지시 없이) · 커밋/푸시(사용자 승인 없이).
- 새 npm 의존성 추가(사용자 승인 없이).

## 변경 기록
- 2026-11-09: 초안 작성 (Cowork).
