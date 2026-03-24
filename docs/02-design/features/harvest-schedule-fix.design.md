# harvest-schedule-fix Design Document

> **Summary**: 수확관리 스케줄 계산을 정식일(transplantDate) 기준으로 수정하고, 육묘(seedling) 단계 스킵 + 달력 뷰 추가
>
> **Date**: 2026-02-24
> **Status**: Draft
> **Planning Doc**: [harvest-schedule-fix.plan.md](../01-plan/features/harvest-schedule-fix.plan.md)

---

## 1. Overview

### 1.1 Design Goals

1. anchorDate를 `stageStartedAt`(배치 생성 시각) 대신 `transplantDate` + 단계 오프셋 기준으로 계산
2. 배치 생성 시 `currentStage`를 정식일 기준으로 자동 판정 (seedling 고정 제거)
3. 육묘(seedling) 프리셋 제거 (종묘사 위탁이므로 불필요)
4. occurrence 생성 시 정식일 이전만 스킵 (과거~오늘 사이도 overdue로 표시)
5. 프론트엔드에 월간 달력 뷰 추가 (리스트 뷰와 토글 전환)

### 1.2 Design Principles

- 기존 API 인터페이스 유지 (breaking change 없음)
- 데이터 모델 변경 없음 (엔티티/테이블 수정 불필요)
- 프론트엔드 달력은 외부 라이브러리 없이 순수 구현

---

## 2. Architecture

### 2.1 변경 범위

```
Backend:
  harvest-task.service.ts  → calcAnchorDate() 전면 수정
                           → STAGE_OFFSETS 상수 추가
                           → STAGE_TASK_PRESETS에서 seedling 제거
                           → generateFlexOccurrencesWithInterval() 과거 날짜 포함
  harvest.service.ts       → create()에서 determineStage() 호출
  harvest.controller.ts    → seedling 단계일 때 applyStageTemplates 스킵

Frontend:
  Harvest.vue              → 달력/리스트 토글 UI + 달력 그리드 컴포넌트
                           → loadOccurrences() 날짜 범위 확장 (달력 뷰 지원)
```

### 2.2 Data Flow (변경 후)

```
배치 생성 → determineStage(sowDate, transplantDate) → currentStage 설정
         → seedling이면 applyStageTemplates 스킵
         → vegetative 이상이면 applyStageTemplates(해당 단계)
         → calcAnchorDate: transplantDate + STAGE_OFFSETS[stage] + startOffsetDays
         → generateFlexOccurrences: schedDate < transplantDate면 스킵 (과거 허용)
```

---

## 3. Backend Changes

### 3.1 STAGE_OFFSETS 상수 추가

**File**: `backend/src/modules/harvest/harvest-task.service.ts`

```typescript
// 정식일 기준 단계별 오프셋 (일)
const STAGE_OFFSETS: Record<string, number> = {
  seedling: 0,         // 파종일 기준 (사용 안함)
  vegetative: 0,       // 정식일부터
  flowering_fruit: 30, // 정식 후 30일
  harvest: 65,         // 정식 후 65일
};
```

### 3.2 STAGE_TASK_PRESETS에서 seedling 제거

**현재 (7종)**:
```
seedling: 육묘 점검
vegetative: 순따기, 유인, 병해충 점검
flowering_fruit: 화방 점검, 적엽
harvest: 수확 점검
```

**변경 후 (6종)**:
```
vegetative: 순따기, 유인, 병해충 점검
flowering_fruit: 화방 점검, 적엽
harvest: 수확 점검
```

육묘 점검은 종묘사 위탁이므로 프리셋에서 완전 제거.

### 3.3 calcAnchorDate() 수정

**현재 (잘못됨)**:
```typescript
private calcAnchorDate(batch: CropBatch, template: TaskTemplate): string {
  const baseDate = batch.stageStartedAt          // ← 배치 생성시각 사용
    ? new Date(batch.stageStartedAt).toISOString().slice(0, 10)
    : batch.transplantDate || batch.sowDate;
  return this.addDays(baseDate, template.startOffsetDays);
}
```

**변경 후**:
```typescript
private calcAnchorDate(batch: CropBatch, template: TaskTemplate): string {
  const stageName = template.stageName || 'vegetative';

  if (stageName === 'seedling') {
    // seedling은 파종일 기준 (실제로는 사용하지 않음)
    return this.addDays(batch.sowDate, template.startOffsetDays);
  }

  // 정식일이 없으면 파종일 기준 (fallback)
  const baseDate = batch.transplantDate || batch.sowDate;
  const stageOffset = STAGE_OFFSETS[stageName] || 0;
  return this.addDays(baseDate, stageOffset + template.startOffsetDays);
}
```

**계산 예시** (정식일: 2026-03-01):

| 작업 | 단계 | stageOffset | startOffsetDays | anchorDate |
|------|------|:-----------:|:---------------:|:----------:|
| 순따기 | vegetative | 0 | 7 | 03-08 |
| 유인 | vegetative | 0 | 0 | 03-01 |
| 병해충 점검 | vegetative | 0 | 0 | 03-01 |
| 화방 점검 | flowering_fruit | 30 | 0 | 03-31 |
| 적엽 | flowering_fruit | 30 | 7 | 04-07 |
| 수확 점검 | harvest | 65 | 0 | 05-05 |

### 3.4 harvest.service.ts create() 수정

**현재**:
```typescript
async create(userId: string, dto: CreateBatchDto) {
  const batch = this.batchRepo.create({
    ...dto,
    userId,
    houseName: dto.houseName || '',
    currentStage: 'seedling',           // ← 항상 seedling
    stageStartedAt: new Date(),
  });
  return this.batchRepo.save(batch);
}
```

**변경 후**:
```typescript
async create(userId: string, dto: CreateBatchDto) {
  const stage = this.determineStage(dto.sowDate, dto.transplantDate);
  const batch = this.batchRepo.create({
    ...dto,
    userId,
    houseName: dto.houseName || '',
    currentStage: stage,
    stage: stage,
    stageStartedAt: new Date(),
  });
  return this.batchRepo.save(batch);
}

private determineStage(sowDate: string, transplantDate?: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!transplantDate) return 'seedling';

  const tp = new Date(transplantDate);
  if (today < tp) return 'seedling';

  const daysSinceTransplant = Math.floor(
    (today.getTime() - tp.getTime()) / 86400000
  );
  if (daysSinceTransplant >= 65) return 'harvest';
  if (daysSinceTransplant >= 30) return 'flowering_fruit';
  return 'vegetative';
}
```

> **Note**: `determineStage` 로직은 `HarvestTaskService`에 이미 존재하므로, `HarvestService`에서는 같은 로직을 private 메서드로 복제하거나, `HarvestTaskService`를 주입하여 호출. 여기서는 의존성 최소화를 위해 private 메서드로 구현.

### 3.5 harvest.controller.ts create() 수정

**현재**:
```typescript
@Post('batches')
async create(@CurrentUser() user: any, @Body() dto: CreateBatchDto) {
  const userId = this.getEffectiveUserId(user);
  const batch = await this.harvestService.create(userId, dto);
  await this.harvestTaskService.applyStageTemplates(userId, batch.id, batch.currentStage);
  return batch;
}
```

**변경 후**:
```typescript
@Post('batches')
async create(@CurrentUser() user: any, @Body() dto: CreateBatchDto) {
  const userId = this.getEffectiveUserId(user);
  const batch = await this.harvestService.create(userId, dto);
  // seedling 단계에서는 프리셋 적용 안함 (종묘사 위탁)
  if (batch.currentStage !== 'seedling') {
    await this.harvestTaskService.applyStageTemplates(userId, batch.id, batch.currentStage);
  }
  return batch;
}
```

### 3.6 generateFlexOccurrencesWithInterval() 과거 날짜 포함

**현재 (line 484)**:
```typescript
if (schedDate < today) continue;   // ← 과거 스킵
```

**변경 후**:
```typescript
// 정식일 이전만 스킵 (과거~오늘 사이는 overdue로 포함)
const batch = await this.batchRepo.findOne({ where: { id: batchTask.batchId } });
const cutoffDate = batch?.transplantDate
  ? new Date(batch.transplantDate)
  : today;
if (schedDate < cutoffDate) continue;
```

**성능 고려**: `batchRepo.findOne()`을 매번 호출하지 않도록, `generateFlexOccurrences()`와 `generateFlexOccurrencesWithInterval()`에 `transplantDate` 파라미터를 추가하는 방식으로 구현.

**최종 시그니처**:
```typescript
private async generateFlexOccurrencesWithInterval(
  batchTask: BatchTask,
  template: TaskTemplate,
  days: number,
  interval: number,
  transplantDate?: string,  // 추가
): Promise<void>
```

호출부에서 `batch.transplantDate`를 전달:
```typescript
// applyStageTemplates() 내에서
await this.generateFlexOccurrences(saved, template, OCCURRENCE_DAYS, batch.transplantDate);
```

---

## 4. Frontend Changes

### 4.1 달력/리스트 토글 UI

**위치**: `Harvest.vue` 작업 탭 필터 행

```
┌──────────────────────────────────────────────┐
│ [전체 그룹 ▾] [전체 배치 ▾]    [리스트] [달력] │
└──────────────────────────────────────────────┘
```

**상태 변수**:
```typescript
const viewMode = ref<'list' | 'calendar'>('list')
```

### 4.2 달력 뷰 레이아웃

```
┌──────────────────────────────────────┐
│  ◀  2026년 3월  ▶                    │
├────┬────┬────┬────┬────┬────┬────────┤
│ 일 │ 월 │ 화 │ 수 │ 목 │ 금 │  토    │
├────┼────┼────┼────┼────┼────┼────────┤
│    │  1 │  2 │  3 │  4 │  5 │   6    │
│    │ ●● │    │ ●  │    │ ●  │        │
├────┼────┼────┼────┼────┼────┼────────┤
│  7 │  8 │  9 │ 10 │ 11 │ 12 │  13    │
│    │ ●  │    │ ●● │    │    │        │
├────┴────┴────┴────┴────┴────┴────────┤
│ ── 선택된 날짜: 3월 8일 ──           │
│ [●] 순따기 - 방울토마토 (석문리)     │
│ [●] 유인 - 방울토마토 (석문리)       │
└──────────────────────────────────────┘

● 빨강 = overdue (지연)
● 파랑 = today (오늘)
● 회색 = planned (예정)
```

### 4.3 달력 구현 상세

**달력 상태 변수**:
```typescript
const calendarDate = ref(new Date())  // 현재 표시 중인 월
const selectedDate = ref<string>('')  // 선택된 날짜 (YYYY-MM-DD)
```

**월간 그리드 생성** (42셀 = 6주 x 7일):
```typescript
const calendarDays = computed(() => {
  const year = calendarDate.value.getFullYear()
  const month = calendarDate.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const startDate = new Date(firstDay)
  startDate.setDate(startDate.getDate() - firstDay.getDay()) // 일요일 시작

  const days: { date: string; day: number; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    days.push({
      date: d.toISOString().slice(0, 10),
      day: d.getDate(),
      isCurrentMonth: d.getMonth() === month,
    })
  }
  return days
})
```

**날짜별 작업 dot 계산**:
```typescript
const tasksByDate = computed(() => {
  const map: Record<string, { overdue: number; today: number; planned: number }> = {}
  const todayVal = todayStr.value
  for (const occ of allOccurrences.value) {
    if (occ.status !== 'planned') continue
    const d = occ.scheduledDate
    if (!map[d]) map[d] = { overdue: 0, today: 0, planned: 0 }
    if (d < todayVal) map[d].overdue++
    else if (d === todayVal) map[d].today++
    else map[d].planned++
  }
  return map
})
```

**선택 날짜 작업 리스트**:
```typescript
const selectedDateTasks = computed(() => {
  if (!selectedDate.value) return []
  return allOccurrences.value.filter(
    o => o.scheduledDate === selectedDate.value && o.status === 'planned'
  )
})
```

**월 이동**:
```typescript
function prevMonth() {
  const d = new Date(calendarDate.value)
  d.setMonth(d.getMonth() - 1)
  calendarDate.value = d
  loadOccurrencesForCalendar()
}
function nextMonth() {
  const d = new Date(calendarDate.value)
  d.setMonth(d.getMonth() + 1)
  calendarDate.value = d
  loadOccurrencesForCalendar()
}
```

**달력 뷰용 occurrence 조회**: 월 이동 시 해당 월의 startDate/endDate로 조회:
```typescript
async function loadOccurrencesForCalendar() {
  const year = calendarDate.value.getFullYear()
  const month = calendarDate.value.getMonth()
  const start = new Date(year, month, 1)
  start.setDate(start.getDate() - start.getDay()) // 그리드 시작일
  const end = new Date(start)
  end.setDate(end.getDate() + 41)                   // 42일 그리드

  await loadOccurrencesWithRange(
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10),
  )
}
```

### 4.4 달력 CSS

```css
.calendar-nav {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.calendar-nav h4 { font-size: 1em; font-weight: 600; }
.calendar-nav button {
  background: none; border: none; font-size: 1.2em;
  cursor: pointer; padding: 4px 10px; color: var(--text-secondary);
}

.calendar-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
}
.calendar-header {
  text-align: center; font-size: 0.78em; font-weight: 600;
  color: var(--text-muted); padding: 6px 0;
}
.calendar-cell {
  min-height: 48px; padding: 4px; text-align: center;
  border-radius: 8px; cursor: pointer; font-size: 0.85em;
  color: var(--text-primary); position: relative;
}
.calendar-cell.other-month { color: var(--text-muted); opacity: 0.4; }
.calendar-cell.today { background: var(--accent-bg); font-weight: 700; }
.calendar-cell.selected { background: var(--accent); color: white; }

.calendar-dots {
  display: flex; gap: 3px; justify-content: center; margin-top: 2px;
}
.dot-overdue { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }
.dot-today { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.dot-planned { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
```

### 4.5 뷰 전환 토글 CSS

```css
.view-toggle {
  display: flex; border: 1px solid var(--border-input); border-radius: 8px; overflow: hidden;
}
.view-toggle button {
  padding: 6px 14px; background: none; border: none;
  font-size: 0.85em; cursor: pointer; color: var(--text-muted);
}
.view-toggle button.active {
  background: var(--accent); color: white; font-weight: 600;
}
```

---

## 5. Implementation Order

### Phase 1: Backend - calcAnchorDate 수정 + STAGE_OFFSETS
1. `STAGE_OFFSETS` 상수 추가
2. `STAGE_TASK_PRESETS`에서 seedling 프리셋 제거 (6종으로 변경)
3. `calcAnchorDate()` 전면 수정
4. `generateFlexOccurrencesWithInterval()`에 `transplantDate` 파라미터 추가
5. `generateFlexOccurrences()` 시그니처 업데이트

### Phase 2: Backend - 배치 생성 로직 수정
1. `harvest.service.ts`: `create()`에서 `determineStage()` 호출
2. `harvest.controller.ts`: seedling이면 `applyStageTemplates` 스킵

### Phase 3: Frontend - 달력/리스트 토글 + 달력 그리드
1. `viewMode` ref 추가
2. 필터 행에 토글 버튼 추가
3. 달력 상태 변수 (`calendarDate`, `selectedDate`)
4. `calendarDays` computed (42셀 그리드)
5. `tasksByDate` computed (날짜별 dot)
6. `selectedDateTasks` computed (선택 날짜 작업)
7. 월 이동 (`prevMonth`, `nextMonth`)
8. `loadOccurrencesForCalendar()` (달력 범위 조회)
9. 달력 HTML 템플릿
10. CSS 스타일

### Phase 4: 빌드 검증
1. `cd backend && npx tsc --noEmit`
2. `cd frontend && npx vue-tsc --noEmit && npm run build`

---

## 6. Verification Checklist

| # | 시나리오 | 예상 결과 |
|---|---------|----------|
| 1 | 정식일 3/1 배치 생성 → 순따기 anchorDate | 3/8 (3/1 + 0 + 7) |
| 2 | 정식일 3/1 배치 생성 → 유인 anchorDate | 3/1 (3/1 + 0 + 0) |
| 3 | 정식일 3/1 배치 생성 → 화방 점검 anchorDate | 3/31 (3/1 + 30 + 0) |
| 4 | 정식일 3/1 배치 생성 → 적엽 anchorDate | 4/7 (3/1 + 30 + 7) |
| 5 | 정식일 3/1 배치 생성 → 수확 점검 anchorDate | 5/5 (3/1 + 65 + 0) |
| 6 | 정식일 없이 배치 생성 → currentStage = seedling, 템플릿 적용 안됨 |
| 7 | 정식일이 과거(1/1)인 배치 생성 → currentStage = vegetative 이상 |
| 8 | seedling 프리셋(육묘 점검) occurrence 생성 안됨 |
| 9 | 정식일 이전 날짜의 occurrence는 생성 안됨 |
| 10 | 정식일~오늘 사이 occurrence는 overdue로 표시 |
| 11 | 달력 뷰에서 월 이동 (< >) 동작 |
| 12 | 달력 날짜 클릭 시 해당 날짜 작업 리스트 표시 |
| 13 | 달력 셀에 색상 dot (빨강/파랑/회색) 표시 |
| 14 | 리스트 뷰 기존 기능 유지 (overdue/today/upcoming) |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-24 | Initial draft |
