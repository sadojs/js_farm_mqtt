# Plan: 관수 자동화 시스템

## Tuya 장비 매핑

| Tuya Code | 용도 | UI 표시명 |
|-----------|------|-----------|
| relay_status | 메인 전원 | - (내부 제어) |
| switch_1 | 타이머 전원/B접점 | 타이머 전원/B접점 |
| switch_2 | 1구역 관수 | 1구역 |
| switch_3 | 2구역 관수 | 2구역 |
| switch_4 | 3구역 관수 | 3구역 |
| switch_5 | 4구역 관수 | 4구역 |
| switch_6 | 5구역 관수 | 5구역 |
| switch_usb1 | 교반기 모터/B접점 | 교반기/B접점 |
| switch_usb2 | 액비모터/B접점 | 액비모터 |
| countdown_* | 각 스위치 카운트다운 | - (내부 제어) |

## FR-01: 장비관리 UI (Devices.vue + Groups.vue)

관수 장비 카드 표시:
```
관수 테스트
  장비
  타이머 전원/B접점     [On/Off 토글]
  교반기/B접점          [On/Off 토글]
```
- switch_1(타이머) → `{ code: 'switch_1', value: true/false }`
- switch_usb1(교반기) → `{ code: 'switch_usb1', value: true/false }`
- 나머지 스위치는 자동화로만 제어 (UI에 노출 안함)

## FR-02: 자동화 룰 - 관수 조건 설정 (Step 4)

Step 1~3 기존 유지. 장비 선택에서 관수(irrigation) 선택 시 Step 4:

### 4-1. 시작시간 설정
- 시간 picker (HH:mm)

### 4-2. 상세 설정
| 항목 | 이름 입력 | 관수시간 | 대기시간 | On/Off | 기본값 |
|------|----------|---------|---------|--------|--------|
| 타이머 전원/B접점 | X | X | X | O | Off |
| 1구역 | O (default "1구역") | O | O | O | On |
| 2구역 | O (default "2구역") | O | O | O | On |
| 3구역 | O (default "3구역") | O | O | O | On |
| 4구역 | O (default "4구역") | O | O | O | On |
| 5구역 | O (default "5구역") | O | O | O | Off |
| 교반기/접점 | X | X | X | O | Off |
| 액비모터 | 고정("액비모터") | 투여시간 | 종료전대기 | X | - |

### 4-3. 반복 설정
- 요일 선택: 월~일 (다중 선택)
- 반복 토글: On → 매주 반복 / Off → 선택 요일만 1회 실행 후 자동 비활성화

## FR-03: 관수 실행 로직 (백엔드 스케줄러)

시작시간부터 활성화(On) 구역 순서대로 실행:

```
[구역N 관수 시작] ──(관수시간-투여시간-종료대기)──> [액비모터 ON]
                  ──(관수시간-종료대기)──────────> [액비모터 OFF]
                  ──(관수시간)──────────────────> [구역N 관수 종료]
                  ──(관수시간+대기시간)─────────> [다음 구역 시작]
```

예시 (관수30분, 대기5분, 액비투여10분, 종료전대기5분):
- 10:00 구역1 ON + 교반기 ON
- 10:15 액비모터 ON (30-10-5=15분 후)
- 10:25 액비모터 OFF (30-5=25분 후)
- 10:30 구역1 OFF + 교반기 OFF
- 10:35 구역2 ON + 교반기 ON (대기5분 후)
- ... 활성화 구역 순서대로 반복

교반기: 각 구역 관수시간 동안만 ON, 대기시간에 OFF

## FR-04: 자동화 룰 목록 UI (Automation.vue)

```
관수 테스트     월,화,수,목,금,토,일  반복     [활성화 토글]
```
- 룰 이름 + 선택 요일 표시 + 반복 여부 + 활성화 토글

## FR-05: 그룹관리 자동화 편집 모달

Groups.vue에서 자동화 룰 수정 모달:
- **2단계만 표시**: 조건 설정 → 확인
- 환풍기, 개폐기에도 동일 적용 (간소화 편집 모달)

## 구현 순서

| Phase | FR | 작업 | 파일 |
|-------|-----|------|------|
| 1 | FR-01 | 관수 장비 UI (타이머/교반기 토글) | Devices.vue, Groups.vue |
| 2 | FR-02 | 자동화 관수 조건 Step 4 컴포넌트 | StepIrrigationCondition.vue (신규) |
| 3 | FR-03 | 관수 스케줄러 백엔드 로직 | irrigation-scheduler.service.ts (신규) |
| 4 | FR-04 | 자동화 목록에 스케줄/반복 표시 | Automation.vue |
| 5 | FR-05 | 그룹관리 자동화 편집 모달 | AutomationEditModal.vue (신규) |
| 6 | ALL | 빌드 + 테스트 | - |

## DB 스키마 변경

automation_rules.conditions에 관수 설정 저장:
```json
{
  "type": "irrigation",
  "startTime": "10:00",
  "timerSwitch": false,
  "zones": [
    { "zone": 1, "name": "1구역", "duration": 30, "waitTime": 5, "enabled": true },
    { "zone": 2, "name": "2구역", "duration": 30, "waitTime": 5, "enabled": true }
  ],
  "mixer": { "enabled": false },
  "fertilizer": { "duration": 10, "preStopWait": 5 },
  "schedule": {
    "days": [1,2,3,4,5,6,0],
    "repeat": true
  }
}
```
- 기존 conditions JSONB 컬럼 활용, 추가 테이블 불필요
