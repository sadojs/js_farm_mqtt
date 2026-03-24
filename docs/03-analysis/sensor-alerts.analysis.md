# Gap Analysis: sensor-alerts

> Date: 2026-02-25 | Match Rate: **97%** | Status: **PASS**

## Summary

| Category | Score |
|----------|:-----:|
| Design Match | 100% |
| Architecture Compliance | 95% |
| Convention Compliance | 95% |
| **Overall** | **97%** |

## Verification Items (sensor-alerts scope)

| # | Item | Status |
|---|------|--------|
| 7 | SensorAlert entity (14 fields) | PASS |
| 8 | SENSOR_ALERT_RULES | CHANGED — 7 → 24 types (co2/soil_moisture 제거, 실제 센서 22종 추가) |
| 9 | Cron 5분 주기 detectAnomalies | CHANGED — standbySet 필터링 추가 |
| 10 | 4개 감지 로직 (no_data/flatline/spike/out_of_range) | CHANGED — latestRows 기반 반복으로 변경 |
| 11 | 중복 알림 방지 (createAlertIfNotExists) | PASS |
| 12 | findOneWithStats 24h 통계 + actionGuides | PASS |
| 13 | resolve + snooze API | ENHANCED — 원본 4개 + 신규 4개 엔드포인트 |
| 19 | sensor-alerts.api.ts 타입 + 메서드 | ENHANCED — 원본 4개 + SensorEntry + 4개 추가 |
| 20 | Alerts.vue 필터칩 + 카드 + 심각도 | ENHANCED — 3탭 UI + 대기/삭제 기능 추가 |
| 21 | AlertDetailModal 24h 통계 + 가이드 + 스누즈 | PASS |
| 22 | /harvest + /alerts 라우트 | PASS |
| 23 | Desktop + mobile 네비게이션 | PASS |
| 24 | AppModule import | PASS |
| 25 | 빌드 통과 | PASS |

**PASS: 8 | CHANGED: 3 | ENHANCED: 3 | MISSING: 0**

## Intentional Changes

| 변경 | 이유 |
|------|------|
| co2/soil_moisture 룰 제거 | 실제 sensor_data에 존재하지 않는 센서 타입 |
| 24개 센서 타입으로 확장 | 기상관측센서 실제 데이터에 맞춤 |
| checkDevice() 반복 방식 변경 | 장비 미보고 센서의 오탐(no_data) 방지 |
| standbySet 필터링 추가 | 대기 목록 센서 알림 생성 방지 |
| findAll() NOT EXISTS 추가 | 대기 센서 알림 조회 제외 |
| addStandby() 자동 해결 | 대기 이동 시 기존 알림 일괄 해결 |
| DELETE /:id 엔드포인트 추가 | 오탐 알림 이력 삭제 기능 |
| 3탭 UI (활성 센서/알림/대기) | 전체 센서 관리 기능 추가 |
| SENSOR_TYPE_LABELS 25개 | 실제 센서 데이터 반영 + 한글(영문) 이중 표기 |

## Design Document Update Needed

설계 문서에 다음 항목 추가 필요:
1. `sensor_standby` 테이블 DDL + SensorStandby 엔티티
2. 센서 목록/대기 관리 엔드포인트 3개
3. 알림 삭제 엔드포인트
4. SENSOR_ALERT_RULES 24개 센서 타입
5. Alerts.vue 3탭 구조
