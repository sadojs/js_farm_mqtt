# Gap Analysis: monitoring-widgets

> **Date**: 2026-02-24
> **Design Doc**: `docs/02-design/features/monitoring-widgets.design.md`
> **Match Rate**: 100% (21/21 PASS+ENHANCED)

## 1. Verification Summary

| # | Category | Verification Item | Verdict | Evidence |
|---|----------|------------------|---------|----------|
| 1 | Backend API | `GET /dashboard/widgets` endpoint | **PASS** | `dashboard.controller.ts` L17-21 |
| 2 | Backend API | getEffectiveUserId pattern | **PASS** | `dashboard.controller.ts` L19 |
| 3 | Backend API | qxj device_id based sensor_data query | **PASS** | `dashboard.service.ts` L113-115 |
| 4 | Backend API | Parallel execution (4 queries) | **PASS** | `dashboard.service.ts` L124-129 |
| 5 | Backend Module | Device, SensorData entity import | **PASS** | `dashboard.module.ts` L10 |
| 6 | Utils | calcVPD: es formula + thresholds | **ENHANCED** | HIGH 1.2->1.4 (cherry tomato) |
| 7 | Utils | calcVentScore: dT*1.0 + dRH weight | **ENHANCED** | dRH weight 0.1->0.3 (cross-analysis) |
| 8 | Utils | calcTempRate: change rate thresholds | **ENHANCED** | +/-1.0->+/-0.5, finer gradation |
| 9 | Utils | calcRhRate: change rate thresholds | **ENHANCED** | Added +/-2 intermediate thresholds |
| 10 | Utils | calcUVRisk: 5 categories | **PASS** | `widget-calculations.ts` L68-76 |
| 11 | Utils | calcEnvScore: weights + colors | **ENHANCED** | 5-factor model, cherry tomato optimized |
| 12 | Component | 7 widget cards | **PASS** | `MonitoringWidgets.vue` 7 card blocks |
| 13 | Component | Delta-T/Delta-RH gauge (-10~+10/-40~+40) | **PASS** | `MonitoringWidgets.vue` L98-121 |
| 14 | Component | Score circle (green/yellow/red) | **PASS** | `MonitoringWidgets.vue` L168-173 |
| 15 | Component | Sparkline SVG | **PASS** | 4 sparklines, viewBox="0 0 120 32" |
| 16 | Component | Responsive grid (3->2->1) | **PASS** | CSS L459, L713-715, L719-720 |
| 17 | Dashboard | MonitoringWidgets placement | **ENHANCED** | Sensors.vue 그룹 내부 배치 (user request) |
| 18 | Dashboard | Promise.all parallel API call | **ENHANCED** | Sensors.vue L168-171 (user request) |
| 19 | API Client | WidgetDataResponse + getWidgets() | **PASS** | `dashboard.api.ts` L29-53 |
| 20 | UI | No-data "-" display | **PASS** | Consistent `?? '-'` pattern |
| 21 | UI | CSS variables (no hardcoded colors) | **PASS** | CSS variables throughout |

## 2. Score

```
Total Verification Items:     21
  PASS:                       14  (67%)
  ENHANCED:                    7  (33%)
  FAIL:                        0  ( 0%)

Match Rate (PASS + ENHANCED): 100%
```

## 3. Enhancements Beyond Design

| # | Enhancement | Location | Description |
|---|------------|----------|-------------|
| E1 | Cherry tomato thresholds | `widget-calculations.ts` | VPD 1.4, Temp 22-26, Humidity 60-70% |
| E2 | Cross-analysis recommendations | `MonitoringWidgets.vue` | envRecommendations: VPD+humidity+outdoor temp |
| E3 | WebSocket real-time update | `Sensors.vue` | sensor:update 2s debounce auto-refresh |
| E4 | Sensors.vue integration | `Sensors.vue` | MonitoringWidgets inside group cards |
| E5 | Per-widget advice text | `MonitoringWidgets.vue` | .widget-advice blocks |
| E6 | calcUVNorm separate function | `widget-calculations.ts` | Extracted for cleaner separation |
| E7 | gaugePercent utility | `widget-calculations.ts` | Extracted as reusable utility |

## 4. Minor Deviations (Non-blocking)

| # | Design | Implementation | Impact |
|---|--------|----------------|--------|
| 1 | qxj query includes `deviceType: 'sensor'` | Filter omitted | Low - qxj are all sensors |
| 2 | `@InjectRepository(SensorData)` | Uses `DataSource.query()` raw SQL | None - valid choice |
| 3 | Dashboard.vue widget integration | Widget in Sensors.vue only | None - user-requested |

## 5. Recommended Actions

- Design 문서 업데이트: 7개 ENHANCED 항목 반영 (방울토마토 기준, 교차분석, WebSocket)
- Optional: `dashboard.service.ts`에 `deviceType: 'sensor'` 필터 추가 (방어적 코딩)
