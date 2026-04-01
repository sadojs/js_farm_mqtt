# Plan: 리포트 비교분석 기능

## 개요

smart-farm-platform의 리포트 페이지 `비교 분석` 탭을 smart-farm-mqtt에 동일하게 구현한다.
두 그룹의 센서 데이터를 선택하여 오버레이 차트 + 통계 비교 테이블로 시각화한다.

## 참조

smart-farm-platform `SensorCompareChart.vue` 컴포넌트를 이식.

## 기능 요약

1. Reports 페이지에 `비교 분석` 탭 추가
2. 두 그룹 선택 → 동일 메트릭 데이터 비교
3. 오버레이 라인 차트 (그룹1: 실선, 그룹2: 점선)
4. 통계 비교 테이블 (평균/최고/최저 + 차이 색상)

## 비교 가능 메트릭

| 메트릭 | 값 | 단위 |
|--------|---|------|
| 온도 | temperature | °C |
| 습도 | humidity | % |
| CO2 | co2 | ppm |
| 조도 | light | lx |
| 토양수분 | soil_moisture | % |

## 기간 옵션

- 1일 (1d)
- 7일 (7d)
- 30일 (30d)

## 영향 범위

| 파일 | 변경 |
|------|------|
| `frontend/src/components/reports/SensorCompareChart.vue` | **신규** — 비교 차트 컴포넌트 |
| `frontend/src/views/Reports.vue` | 탭 추가, 컴포넌트 import |

## 백엔드

변경 없음 — 기존 `/reports/hourly` API에 groupId 파라미터로 그룹별 조회 이미 지원.

## 구현 순서

1. SensorCompareChart.vue 컴포넌트 생성 (platform에서 이식)
2. Reports.vue에 탭 + 컴포넌트 연결
