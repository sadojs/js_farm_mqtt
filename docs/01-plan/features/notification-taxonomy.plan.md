# Plan — notification-taxonomy (알림 항목 정리 + 앱 푸시 정책 초안)

**Created**: 2026-07-15
**Updated**: 2026-07-20 — **상태: 웹 미적용 / iOS·Android 앱 프로젝트에서 구현 예정**
**Owner**: 오정석
**Phase**: Plan (참고 문서)

> ⚠️ **적용 범위 결정 (2026-07-20)**
> 현재 웹 서비스(데스크톱·모바일 브라우저)는 알림 로직이 안정적으로 동작 중.
> 이번 개편은 위험 대비 이득이 작다고 판단하여 **웹에는 적용하지 않음**.
> 대신 iOS/Android 앱을 새 프로젝트로 개발할 때 이 문서를 바탕으로
> 처음부터 통합 알림 인프라를 도입한다.
>
> **참고 시 유의**
> - `notifications` 테이블·모듈은 앱 백엔드 프로젝트에서 신설
> - 옵트인 / 방해금지 / dedup / FCM+APNs / 딥링크는 앱 기획 그대로 활용
> - 웹의 기존 `notification.store` + `sensor_alerts` 는 손대지 않음
> - "폼 검증 → formError 마이그레이션" 은 웹 개편이라 이번엔 제외 (앱 재개발 시 처음부터 분리)

---

## 1. 현재 알림 시스템 — 두 트랙

### 트랙 A: 인앱 알림 (`notification.store` — Pinia)

- **토스트**: 3~8초 노출 후 소멸 (성공 3s / 정보 5s / 경고 6s / 에러 8s)
- **알림 센터** (상단 벨 아이콘): `error` + `warning` 만 영구 보관 (최대 50건, 60초 dedup)
- `success` / `info` 는 센터에 저장 안 함 (사용자 액션 즉시 피드백)

### 트랙 B: DB 저장 이상 알림 (`sensor_alerts` 테이블 → `/alerts` 화면)

- 시스템이 자동 감지한 센서/게이트웨이 이상
- 5종 alertType × 2 severity, 해결/스누즈 상태 관리
- 자동 해제(auto-resolve) 지원 — 정상 복귀 시 무해결 알림 자동 종료

### 실시간 전달: WebSocket (`useWebSocket`)

백엔드 → 프론트 push 이벤트:
- `sensor:update`, `device:status`, `device:switch-update`, `device:replaced`
- `automation:executed`, `irrigation:started`, `irrigation:stopped`
- `gpio:status`, `fallback:mode-changed`
- `notification:new` (범용 push — 백엔드가 임의 알림 emit 가능)

---

## 2. 현재 알림 트리거 인벤토리

### A. 인앱 토스트/센터 (사용자 액션 피드백) — 총 100+ 지점

| 카테고리 | 예시 | severity |
|---|---|---|
| 인증 | 로그인 실패, 접근 거부, 리소스 없음 | error/warning |
| 원격 설정 | Wi-Fi/Hostname/Gateway ID/Server IP 변경 요청 실패·응답 시간 초과 | error/warning |
| 자동제어 | 룰 저장 실패, "규칙 X 실행됨/실패" | info/warning |
| 방재일정 | 저장·이동·삭제·구역 삭제 실패, "먼저 구역을 추가" | error/warning |
| 일꾼관리 | 저장·가불 추가·정산 요청·근무 설정 실패 | error/warning |
| 게이트웨이 | GPIO 조작 실패, 우적센서 상태 변경 실패, 채널 코드 변경 실패 | error |
| 일괄 제어 | 성공 요약, "일부 실패 N대", "모두 실패" | success/warning/error |
| 구역 설정 | 표시 설정 저장 실패, 상태 미변경, 상태 확인 실패 | error/warning |
| 장치 교체 | 미리보기 실패, 스캔 시작 실패, 페어 선택 필요, 중복 IEEE | error |
| 네트워크 | 연결 실패, 연결 복구, 서버 오류 | error/success |

### B. 시스템 상태 변화 (WebSocket 실시간)

| 이벤트 | 트리거 | 현재 표시 |
|---|---|---|
| 서버 연결 실패/복구 | Socket.io disconnect/reconnect | 토스트 |
| 자동 제어 실행 (성공) | automation-runner | 토스트 `info` |
| 자동 제어 실행 실패 | automation-runner | 토스트 `warning` (센터 O) |
| 페일오버 모드 변경 | fallback-config | 화면 배지 갱신, 별도 알림 X |
| gpio-agent 자동 복구 (성공/실패) | gateway-manager auto-restart | activity_log 만 |

### C. 센서 이상 알림 (DB `sensor_alerts`)

**5가지 alertType** × 2 severity (warning/critical):

| alertType | 설명 | 임계값 |
|---|---|---|
| `no_data` | 데이터 없음 | 60분 → warning / 360분 → critical |
| `flatline` | 24시간 값 변화 없음 (epsilon 기준) | 센서별 (예: 온도 0.3°C) |
| `spike` | 10분 내 급변 | 센서별 (예: 온도 8°C, 습도 25%) |
| `out_of_range` | 물리적 범위 초과 | 센서별 (예: 온도 -15~55°C) |
| `unstable` | 반복 오프라인 (flapping) | 6시간 내 3회 이상 no_data 해제 |

**추가**: 게이트웨이 5분 무응답 → `no_data` critical 자동 생성

---

## 3. 문제점 (앱 개발 전 정리 이유)

### P1. 알림 분류가 모호함
- 폼 검증 실패("이름을 입력해 주세요") 도 warning 으로 센터에 쌓임 → **노이즈**
- 사용자가 방금 저지른 실수까지 벨 아이콘 배지에 카운트

### P2. 앱 푸시 후보가 미분리
- 인앱 토스트 100+ 지점 중 **앱 푸시로 보내야 할 것 / 앱 안에서만 처리할 것** 미구분
- "저장 성공" 이 백그라운드 앱 푸시로 오면 사용자는 짜증
- "센서 5시간 무응답" 은 앱 밖에서도 알아야 하는데 현재는 인앱만

### P3. 심각도 표기 불일치
- 프론트: `success/info/warning/error`
- 백엔드 sensor_alerts: `warning/critical`
- 앱 푸시에선: `informational/timeSensitive/critical` (Apple), `default/high/max` (Android)
→ 3계층 매핑 정의 필요

### P4. 중복/스팸 방지 미흡
- 인앱: 60초 dedup 있음
- 앱 푸시: 정책 미정 (같은 센서가 매 분 반복 발생 시 20건 폭탄 가능)

### P5. 사용자 설정 부재
- 어떤 알림을 받을지 사용자가 선택할 수 없음
- 방해금지 시간대(예: 22:00~07:00 조용) 없음

---

## 4. 추천 알림 정책 (앱 개발 시 반영)

### 4.1 3단계 채널 구분

| 채널 | 도구 | 대상 이벤트 | 사용자 방해도 |
|---|---|---|---|
| **폼 피드백** | 필드 옆 인라인 에러 | 이름 필수, 형식 오류 등 | 없음 (센터 X) |
| **인앱 토스트** | 화면 우상단 스낵바 | 저장 성공/실패, 조작 결과 | 낮음 (자동 소멸) |
| **알림 센터** | 벨 아이콘 (인앱) | 시스템 상태 변화, 사용자 액션 결과 중 중요한 것 | 중간 |
| **앱 푸시** | OS 알림 | 즉시 조치 필요한 이상 | 높음 (진동/사운드) |

### 4.2 앱 푸시 우선순위 (Critical / Warning / Info)

#### 🔴 Critical — 진동+사운드 (Time-Sensitive)
사용자가 앱 밖이라도 즉시 확인해야 하는 사건.

- 센서 no_data 6시간 이상 (하드웨어 이상)
- 게이트웨이 오프라인 30분 이상
- **페일오버 모드 진입** (서버 단절 → Pi 자동 제어 시작)
- 관수 자동 종료 실패 (30분 초과 밸브 열림 상태 유지)
- 개폐기 인터록 위반 (열림/닫힘 동시 ON 감지)
- 우적센서 감지 → 개폐기 강제 CLOSE

#### 🟠 Warning — 무음/짧은 진동 (그룹 요약 가능)
알아둘 필요는 있지만 즉각 대응은 아님.

- 센서 spike (급변 감지)
- 센서 out_of_range (일시적 물리 범위 초과)
- 배터리 20% 이하 (센서/장치)
- 자동제어 규칙 실행 실패

#### 🔵 Info — 조용한 알림 (Notification Summary — iOS)
백그라운드 요약 정리에 포함.

- 게이트웨이 자동 복구 완료
- Zigbee 신규 페어링 감지
- 일일 요약 (오전 8시): 어제 관수 N회, 최고온 X°C 등

### 4.3 앱 푸시로 절대 보내지 말 것

**앱 안에서만 필요한 정보** — 푸시 X, 토스트만:

- 저장/삭제 성공 (사용자가 직접 한 액션)
- 로그인 실패 (앱 안 로그인 화면에서 알림)
- 폼 검증 에러
- WebSocket 재연결 (앱이 켜져 있을 때만 의미)
- "자동 제어 규칙 X 실행됨" 성공 케이스 (실패만 push)
- 원격 설정 요청 성공/실패 (해당 화면 열려있을 때만 관심)

### 4.4 스팸 방지 규칙

**앱 푸시 dedup**:
- 같은 센서의 같은 alertType 은 **1시간 내 1회** 만 푸시
- Critical 은 예외 (스누즈 후 재발 시에도 계속 알림)
- 반복 발생 시 "센서 X 알림 5회 반복" 그룹 요약 (iOS Notification Grouping)

**방해금지 시간대**:
- 사용자 설정 가능 (기본 22:00~07:00)
- 이 시간대엔 Warning/Info 는 사일런트 큐잉 후 아침 8시 요약 배송
- Critical 은 무시하고 즉시 알림

**사용자별 채널 옵트인**:
- 설정 → 알림에서 카테고리별 토글:
  - 센서 이상 (Critical/Warning 각각)
  - 자동제어 실패
  - 페일오버 이벤트
  - 일일 요약 리포트
  - 배터리 저 알림

### 4.5 심각도 매핑 표

| Level | 백엔드 severity | 프론트 type | iOS interruption | Android importance |
|---|---|---|---|---|
| Critical | critical | error | timeSensitive | HIGH (heads-up) |
| Warning | warning | warning | active | DEFAULT (notify) |
| Info | (없음) | info | passive | LOW (silent) |
| Success | (없음) | success | (푸시 X) | (푸시 X) |

---

## 5. 추가 신규 알림 (현재 없지만 도입 권장)

**제외한 카테고리**: 방재일정 · 일꾼정산 · 배포 관련 알림은 앱 푸시 대상 아님.
(해당 화면에서 별도로 관리 — 앱 푸시 소음 방지)

| 항목 | 이유 | 심각도 |
|---|---|---|
| 배터리 저 (센서/장치 20% 이하) | Zigbee 배터리 센서 사망 예방 | Warning |
| 배터리 방전 (5% 이하) | 즉시 교체 필요 | Critical |
| 우천 감지 → 개폐기 자동 폐쇄 실행 | 사용자가 지금 어떤 조치가 일어났는지 알아야 함 | Warning |
| Zigbee 페어링 실패 (게이트웨이 로그 기반) | 페어링 재시도 안내 | Info |
| 게이트웨이 디스크 용량 부족 (>90%) | 로그 회전 실패 예방 | Warning |
| Fallback 이벤트 (개폐기 스케줄 실행) | 페일오버 모드에서 자동 실행된 이벤트 요약 | Info |

---

## 6. 앱 푸시 인프라 결정 사항 (사전 필요)

- **FCM (Android) + APNs (iOS) 통합 서비스** 결정 → OneSignal / Firebase Cloud Messaging / Expo Notifications
- **디바이스 토큰 등록 API** — 로그인 시 백엔드에 저장
- **사용자별 채널 옵트인 저장** → `user_notification_preferences` 테이블
- **푸시 발송 큐** — Bull queue 활용 (이미 Redis 있음)
- **개인정보 최소화** — 알림 페이로드에 민감정보(비밀번호/토큰) 금지
- **딥링크** — 알림 탭 시 해당 화면으로 이동 (예: 센서 이상 알림 → /alerts?id=xxx)

---

## 7. 다음 단계

- [ ] 사용자 검토 후 우선순위 확정
- [ ] `/pdca design notification-taxonomy` — 심각도 매핑 코드, 옵트인 테이블, 푸시 서비스 통합 명세
- [ ] 별도 기획: `mobile-push-service` — FCM/APNs 통합
- [ ] 별도 기획: `notification-preferences-ui` — 사용자 옵트인 화면
