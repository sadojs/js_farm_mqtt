# Plan: sensor-display-ux-fix

## Overview
센서 데이터 표시 UX 개선 - 대시보드/그룹관리/실시간모니터링 페이지의 센서 정보 가독성 향상

## Requirements (FR)

### FR-01: 대시보드 센서현황 개선
- **문제**: 센서 데이터가 많아지면 센서명이 가려짐 (item-left flex:1이 sensor-values에 밀림)
- **해결**: 레이아웃을 2줄 구조로 변경 (상단: 센서명 + 상태, 하단: 센서 데이터 칩)
- **대상 파일**: `frontend/src/components/dashboard/SummaryCards.vue`

### FR-02: 그룹관리 센서 항목명 표시
- **문제**: 센서 값만 연속으로 표시되어 어떤 항목인지 구분 불가 (`-2.9°C 76% 0.0mm 0 -4.5°C`)
- **해결**: 각 값에 항목명 라벨 추가 (장비관리 카드 스타일 참고 - 그리드 레이아웃)
- **대상 파일**: `frontend/src/views/Groups.vue`

### FR-03: 실시간 모니터링 디자인 조정
- **문제**: 센서 카드 폰트가 너무 크고(40px) 그리드가 좁아 데이터 5개일 때 보기 불편
- **해결**: 폰트 축소 (장비관리 22px 참고), 그리드 minmax 넓히기 (240→360px), 값/라벨을 가로 배치
- **대상 파일**: `frontend/src/views/Sensors.vue`

### FR-04: device.store.ts 디버그 로그 제거
- **문제**: 이전 작업에서 추가한 console.log 디버깅 코드 남아있음
- **해결**: 배포 전 console.log 제거
- **대상 파일**: `frontend/src/stores/device.store.ts`

## Implementation Order

| Phase | Task | File |
|-------|------|------|
| 1 | 대시보드 센서현황 2줄 레이아웃 | SummaryCards.vue |
| 2 | 그룹관리 센서값에 라벨 그리드 | Groups.vue |
| 3 | 실시간 모니터링 폰트/그리드 조정 | Sensors.vue |
| 4 | 디버그 로그 제거 + 빌드 검증 | device.store.ts |

## Design Reference
- 장비관리(Devices.vue) 센서 카드 스타일: 22px bold + 12px unit + 12px label, `grid-template-columns: repeat(auto-fit, minmax(80px, 1fr))`
- 센서 칩 스타일: `padding: 4px 10px; border-radius: 6px; background: var(--sensor-bg)`
