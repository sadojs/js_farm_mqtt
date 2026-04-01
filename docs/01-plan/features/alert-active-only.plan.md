# Plan: 센서 알림 - 활성 알림만 표시

## 개요

센서 알림 페이지에서 이미 해결(`resolved`)되었거나 삭제된 알림은 기본적으로 표시하지 않고,
현재 발생 중인 알림만 보여주도록 변경한다.

## 현재 문제

- 백엔드 `findAll()`이 resolved 필터 없이 호출되면 해결된 알림까지 전부 반환
- 프론트엔드 `loadAlerts()`가 필터 없이 전체 데이터 요청
- 기본 필터가 `'all'`이므로 해결된 알림도 목록에 노출됨
- 시간이 지날수록 해결된 알림이 쌓여 UX 저하

## 변경 목표

1. **기본 표시**: 미해결(active) 알림만 보여줌
2. **필터 변경**: `전체` 필터를 `현재 발생` 으로 변경, 기본값을 `unresolved`로
3. **해결됨 필터**: 필요 시 해결된 알림도 볼 수 있도록 유지
4. **백엔드**: `findAll()` 기본 쿼리에 `resolved = false` 적용

## 영향 범위

| 파일 | 변경 |
|------|------|
| `backend/src/modules/sensor-alerts/sensor-alerts.service.ts` | findAll() 기본 resolved=false 필터 적용 |
| `backend/src/modules/sensor-alerts/sensor-alerts.controller.ts` | resolved 쿼리 파라미터 기본값 변경 |
| `frontend/src/views/Alerts.vue` | 기본 filter를 `unresolved`로, 필터 옵션 레이블 정리 |

## 구현 순서

1. Backend: findAll 기본 필터 변경
2. Frontend: 기본 filter, 필터 옵션 변경
