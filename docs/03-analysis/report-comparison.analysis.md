# Gap Analysis: report-comparison

> Design: `docs/02-design/features/report-comparison.design.md`
> Date: 2026-04-01

## Overall Score

| Category | Score |
|----------|:-----:|
| SensorCompareChart.vue (신규) | 100% (15/15) |
| Reports.vue (수정) | 100% (6/6) |
| **Overall** | **100% (21/21)** |

## SensorCompareChart.vue (15 checkpoints)

| # | Check | Status |
|---|-------|:------:|
| 1 | 두 그룹 select + "vs" 레이블 | ✅ |
| 2 | 메트릭 5개 옵션 | ✅ |
| 3 | 기간 3개 옵션 (1d/7d/30d) | ✅ |
| 4 | 비교 버튼 disabled 조건 | ✅ |
| 5 | Canvas 기반 Chart.js 직접 렌더링 | ✅ |
| 6 | 그룹1 실선 초록, 그룹2 점선 파랑 | ✅ |
| 7 | tension 0.3, pointRadius 2 | ✅ |
| 8 | 통계 테이블 3행 4열 | ✅ |
| 9 | diff 색상 (빨강/파랑/회색) | ✅ |
| 10 | reportApi.getHourlyData() 사용 | ✅ |
| 11 | avg_value 필드 사용 | ✅ |
| 12 | PERIOD_MS 기간 변환 | ✅ |
| 13 | EmptyState 컴포넌트 | ✅ |
| 14 | onUnmounted chart destroy | ✅ |
| 15 | 의존성 4개 import | ✅ |

## Reports.vue (6 checkpoints)

| # | Check | Status |
|---|-------|:------:|
| 1 | main-tabs 탭 UI 2개 | ✅ |
| 2 | reportTab state | ✅ |
| 3 | SensorCompareChart 조건부 렌더링 | ✅ |
| 4 | 기존 콘텐츠 template 래핑 | ✅ |
| 5 | SensorCompareChart import | ✅ |
| 6 | 탭 CSS 스타일 | ✅ |

## Gaps Found

없음.

## Match Rate: **100%** ✅
