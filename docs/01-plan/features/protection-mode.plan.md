---
feature: protection-mode
title: 방재 모드 (하우스 밀폐 타이머)
status: Draft
author: sadojs@gmail.com
created: 2026-10-01
---

# 방재 모드 (하우스 밀폐 타이머)

## 1. 배경 / 문제

약제 살포(방재) 시에는 하우스를 밀폐해야 한다 — **개폐기를 닫고 유동팬을 정지**시켜
약액이 바람에 날아가거나 희석되지 않게 한다. 현재는 구역관리의 **일괄제어**로 하우스를
선택해 일괄 정지시킬 수 있으나:

- **타이머가 없다** → 작업 후 수동으로 다시 자동제어로 복귀시켜야 함(잊으면 계속 밀폐).
- 일괄제어는 "즉시·영구" 성격이라 방재처럼 "N시간 뒤 자동 복귀"에 맞지 않음.

일괄제어는 그 자체로 필요하므로, **방재 모드를 별도 기능으로 추가**한다.

## 2. 목표

- 하우스(구역)를 선택해 **개폐기 닫기 + 유동팬 정지**를 **지정 시간(N시간) 동안** 적용.
- 시간 만료 시 **자동으로 해제**되어 자동제어로 복귀.
- 방재 동안 **자동화룰이 해당 장치를 제어하지 못함**(타이머 override 재사용).
- 기본 동작(개폐기 닫기·유동팬 정지)은 **스텝에서 개별 비활성화** 가능.

## 3. 비목표 (이번 범위 아님)

- 예약(스케줄) 방재 — 즉시 시작만. (예약은 기존 방재일정 모듈 영역, 추후 연계)
- 관수/액비 제어 — 이번엔 개폐기·유동팬만. (스텝 구조는 확장 가능하게)
- 다중 하우스 동시 방재 — 1회 1구역. (추후 확장)

## 4. 진입 메뉴 (확정)

**구역관리(Groups) 페이지 헤더, 기존 ⚡일괄제어 버튼 옆에 🛡 "방재" 버튼.**
일괄제어(즉시·영구) ↔ 방재(타이머·밀폐 프리셋)로 역할이 나란히 대비된다.
권한: `!isFarmUser` (일괄제어와 동일).

## 5. UX — 스텝 모달 (BulkControlModal 패턴 재사용)

```
🛡 방재 모드
STEP 1. 하우스(구역) 선택     [석문연동 ▼]   (현재 구역 기본 선택)
STEP 2. 동작 선택
          ☑ 개폐기 닫기  (기본 ON, 토글)
          ☑ 유동팬 정지  (기본 ON, 토글)
          → 영향 미리보기: 개폐기 2 · 유동팬 3
STEP 3. 방재 시간   [1][2][3][6][12]시간  + 직접입력(최대 12시간/720분)   (확정)
⚠ 이 장치들을 제어 중인 자동제어 룰 N개는 방재 동안 정지됩니다.
                      [취소]  [방재 시작]
```

- 최소 1개 동작은 선택돼야 시작 가능.
- 실행 전 영향 자동화룰 미리 안내(일괄제어 패턴 동일, `POST /automation/devices/active-rules`).

### 진행 상태 배너 / 해제
- 구역관리 상단에 **"🛡 방재 진행 중 · 2시간 34분 남음 [해제]"** 배너
  (자동제어 원복 배너와 동일 위치/패턴).
- [해제] → 그룹 장치 타이머 취소 → 자동제어 복귀.
- 만료 시 기존 override 만료 로직으로 자동 해제.

## 6. 백엔드 설계

### 신규 엔드포인트
`POST /groups/:id/protection`  (JwtAuthGuard, admin/farm_admin)
```jsonc
// 요청
{ "durationMinutes": 180, "closeOpeners": true, "stopFans": true }
// 응답
{ "ok": true, "until": "...", "applied": { "openers": 2, "fans": 3 }, "stoppedRules": 1 }
```
`DELETE /groups/:id/protection` → 그룹 내 방재 타이머 전부 취소.
`GET /groups/:id/protection` → 현재 방재 상태(until, 대상 수) — 배너용.

### 동작
1. 그룹의 actuator 조회 → 개폐기(opener_open/close)·유동팬(fan) 선별.
2. closeOpeners=true → 각 개폐기 쌍에 **타이머(close, durationMinutes)** = 기존 `setDeviceTimer({direction:'close'})` 재사용.
3. stopFans=true → 각 유동팬에 **타이머(off, durationMinutes)** = `setDeviceTimer({value:false})` 재사용.
4. 각 타이머가 `userOverride + overrideUntil` 설정 → **자동화 러너가 자동 skip**
   (2026-10-01 수정분: `clearRelayActivePhase`가 활성 타이머를 보존, `executeAction`/`executeRelayAction`이 userOverride skip).
5. activity_logs: `protection.start` / `protection.cancel` 기록.

> **자동화 억제는 추가 구현이 거의 없음** — 타이머 메커니즘이 이미 자동화를 막는다.
> 방재는 "그룹 단위로 타이머를 일괄 적용"하는 얇은 래퍼.

## 7. 데이터
- 신규 테이블 불필요. 장치별 `deviceSettings.overrideUntil/userOverride`에 이미 상태가 담김.
- 방재 "묶음" 식별이 필요하면 `deviceSettings.overrideReason='protection'` 선택적 추가
  (배너 집계·해제 스코프 명확화용). — 구현 시 결정.

## 8. 엣지케이스
- **개폐기 인터록**: 닫기 타이머가 controlDevice 경로로 처리 → 열기 OFF 인터록 정상.
- **중첩 실행**: 이미 방재 중 재시작 → 시간 덮어쓰기(연장).
- **일괄제어와 충돌**: 방재 중 일괄제어로 수동 조작 시 → 사용자 의도 우선(기존 override 갱신).
- **farm_user**: 버튼 숨김 + 백엔드 403.
- **모바일/태블릿**: 버튼·모달 반응형(기존 패턴).

## 9. 작업 분해 (구현 단계)
1. BE: `GroupsController.protection` (start/cancel/status) + `GroupsService` 로직(타이머 래핑).
2. BE: activity-log 연동, (선택) overrideReason='protection'.
3. FE: 구역관리 헤더 🛡버튼 + `ProtectionModal.vue`(3스텝).
4. FE: 진행 배너 + 해제 + 잔여시간 카운트다운(기존 timer-badge 패턴).
5. E2E: `verify-protection-mode.ts` — 방재 시작→개폐기/팬 타이머+자동화 skip→해제.
6. 검증(로컬) → 프로덕션 배포.

## 10. 확정된 결정
- 메뉴: 구역관리 일괄제어 옆. ✅
- 시간: 프리셋[1/2/3/6/12h] + 직접입력(≤720분). ✅
- 기본 동작: 개폐기 닫기·유동팬 정지 ON, 스텝에서 토글. ✅
- 자동화 억제: 타이머 override 재사용. ✅
