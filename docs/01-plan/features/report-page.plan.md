# Plan: Report Page 리디자인 v2

## 현황 분석

### DB 현재 상태
- **석문리 하우스 그룹**: `6eb2736f-e55b-417a-a2fd-1c5f9c42c46d`
  - 센서: 석문리기상관측센서 (`986948e2`) → temperature, humidity, dew_point, uv, rainfall 수집 중
  - 액추에이터: 석문리 왼쪽2동 휀(fan), 석문리 개폐기(열림/닫힘)
- **sensor_data**: 2,206건, 5분 간격 수집 중 (최근 12시간 temperature 146건, humidity 146건)
- **sensor_data_hourly**: 테이블 미존재 → 쿼리 시 `date_trunc('hour')` 직접 집계 필요

### 백엔드 (이미 구현됨)
- **reports.service.ts**: `getStatistics()`, `getHourlyData()`, `getActuatorStats()`, `exportCsv()` 존재
- **reports.controller.ts**: `/reports/statistics`, `/reports/hourly`, `/reports/actuator-stats`, `/reports/export/csv`, `/reports/export/pdf`
- **sensor-collector.service.ts**: 5분마다 Tuya→sensor_data 저장

### 프론트엔드 (부분 구현)
- **Reports.vue**: 필터(그룹/하우스/센서타입/기간) + 통계카드 + 차트 + 테이블 존재
- **report.api.ts**: API 호출 정의됨
- **chart.js + vue-chartjs**: 이미 설치됨

## 요구사항 (FR)

### FR-01: UI 리디자인 (첨부 디자인 기반)
- **하우스 선택 메뉴 제거** (그룹 선택만 유지)
- 기간 선택: 버튼 그룹 (1일 / 7일 / 1개월 / 기간 선택)
- 다운로드: CSV / PDF 버튼
- 통계 카드 3개: 평균 온도, 평균 습도, 장비 가동 시간
- 차트1: "온도 및 습도 추이" — Line Chart (온도=파랑, 습도=초록, 이중 축)
- 차트2: "장비 가동 현황" — Bar Chart (보라색, 시간대별 가동 장비 수)
- 테이블: "상세 데이터" — 시간 / 온도 / 습도 / 가동 장비
- **우선순위**: High

### FR-02: 초기 렌더링 기본값
- 페이지 진입 시: 현재 시간 ~ 12시간 전 데이터 자동 조회
- 기본 센서 타입: temperature + humidity
- 기본 그룹: 석문리 하우스 (첫 번째 그룹 자동 선택)
- **우선순위**: High

### FR-03: 백엔드 API 보완
- `getHourlyData`: groupId 기반으로 해당 그룹 센서 데이터 시간별 집계
- `getActuatorStats`: automation_logs에서 시간대별 가동 장비 수 집계
- sensor_data_hourly 테이블 미존재 → `date_trunc('hour')` SQL로 직접 집계
- **우선순위**: High

### FR-04: CSV/PDF 다운로드
- CSV: 기존 API 활용 (report.api.ts의 exportCsv)
- PDF: 프론트에서 html2canvas 또는 jsPDF로 클라이언트 생성
- **우선순위**: Medium

## 구현 순서

| Phase | FR | 작업 | 파일 |
|-------|-----|------|------|
| 1 | FR-03 | 백엔드 hourly/actuator-stats API 보완 | reports.service.ts, reports.controller.ts |
| 2 | FR-01,02 | Reports.vue UI 전면 리디자인 | Reports.vue |
| 3 | FR-04 | CSV/PDF 다운로드 연동 | Reports.vue, report.api.ts |
| 4 | ALL | 빌드 확인 + 테스트 | - |

## 기술 결정
- 차트: chart.js + vue-chartjs (이미 설치됨)
- 날짜: dayjs (이미 설치됨)
- PDF: 클라이언트 사이드 생성 (jsPDF + html2canvas) or 기존 백엔드 엔드포인트
- 시간별 집계: `date_trunc('hour', time)` SQL 직접 사용 (hourly 테이블 미존재)
