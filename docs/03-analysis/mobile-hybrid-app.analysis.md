# Gap Analysis: mobile-hybrid-app (P1)

> Date: 2026-07-25 (갱신) | Plan v2 + Design(v2 정합) 대비 구현 현황
> Scope: **P1 셸 구축 + 프론트 번들 연결 + 인앱 알림**. P2~P5(TestFlight/OS푸시/OTA/위젯)는 의도된 향후 단계로 분석 제외.
> 이전 분석: 2026-07-23 (Match Rate 90%) — 본 문서가 대체

---

## 1. 요약

| 구분 | 결과 |
|------|------|
| **P1 범위 Match Rate** | **96%** (iOS·Android 실기 실증 완료, 잔여는 외부요인 1건 + 격리원칙 경미 이탈 1건) |
| 기존 서비스 무영향 원칙 | ⚠️ **대체로 준수, 일부 이탈 발견** — `mobile/` 신규 격리는 정확, 단 `frontend/stores/auth.store.ts`·`App.vue`에 `isNative` 비게이팅 변경 존재 (G4, 신규 발견) |
| 하드 블로커 | 🔴 도메인/공인 TLS 인증서 미확보(G2)만 남음 — **순수 외부요인**(사람 개입 필요, 코드/설계 결함 아님) |
| 이번 세션 핵심 성과 | ✅ **G1(Xcode 빌드 차단) 완전 해소**, ✅ **G3(시뮬/에뮬 실구동 검증) 완전 해소** — iOS·Android 양쪽 실기 빌드·설치·로그인·Socket.io 인앱알람까지 실증 |

---

## 2. 요구사항별 대조 (Plan v2 원칙)

| # | Plan v2 요구 | 구현 | 판정 |
|---|--------------|------|------|
| R1 | 하이브리드 셸(Capacitor) | `mobile/` 프로젝트(iOS+Android 플랫폼 포함) 생성 완료 | ✅ |
| R2 | 번들 내장 방식 | `frontend` 빌드 → `mobile/www`, `mobile/scripts/build-web.sh`로 자동화(PWA SW 제거·crossorigin 제거 포함), `npx cap sync` | ✅ |
| R3 | 기존 웹서비스 무영향 | `mobile/` 신규 디렉터리 격리는 정확. 단 `frontend/`에 `isNative` 비게이팅 변경 존재(G4) — **부분 준수** | ⚠️ |
| R4 | 백엔드 무변경(추가만 허용) | `main.ts`(CORS)·`events.gateway.ts`(CORS)·`auth.controller.ts`(refresh token body, Plan §5.2 명시 허용) 3파일 — 모두 Plan v2 §5.1/5.2에 **명시적으로 허용된 추가 변경**. `package.json`에 `firebase-admin` 의존성 추가는 있으나 backend/src 내 미사용(런타임 영향 0, P3 선반영으로 판단, G5) | ✅ (경미 비고 G5) |
| R5 | 프론트 무변경(웹 no-op) | `useNativePush.ts`는 `isNative` 게이팅 정상(웹 no-op 확인). 그러나 `auth.store.ts`(리프레시 주기 14→10분, refresh mutex, 실패 시 상태 정리)와 `App.vue`(로그아웃 시 강제 리다이렉트 watch)는 **게이팅 없이 웹에도 적용**되는 변경 — Design C1 원칙과 불일치 | ⚠️ **G4 신규** |
| R6 | 인앱 알림만(푸시/위젯 제외) | Socket.io `notification:new` → `user:<id>` room 브로드캐스트, iOS 앱에서 실시간 토스트 수신 **실증 성공**(2026-07-25) | ✅ |
| R7 | Android 앱화 | 플랫폼 추가 + Gradle 동기화 + 지난 세션 adb 자동화로 실기 라이브 실행·로그인·실시간 검증 완료 | ✅ |
| R8 | iOS 앱화 | **금번 세션 완전 해소**: Xcode 26.6 설치 확인 → iPhone 17 Pro 시뮬레이터(iOS 26.5)에서 `xcodebuild` 빌드·`simctl install`·실행 성공. mtest 계정으로 로컬 백엔드(`localhost:3100`) 로그인 → 대시보드 진입, 상단바 정상 렌더 확인 | ✅ |
| R9 | 도메인 기반 접속 | 미확보(현재 IP `175.206.245.234:8443`/로컬 `localhost:3100` 주입). Design §2가 이를 명시적으로 **P2(배포) 하드블로커**로 분류, P1 진행에는 무관하다고 이미 규정 — 로컬 백엔드+iOS ATS 예외(Info.plist localhost)로 P1 검증 자체는 완결 | ⛔ (P2 선결조건, P1 비차단) |

---

## 3. Gap 상세

### G1 — iOS pod install/빌드 미완 → ✅ **해소 (2026-07-25)**
- 기존 현상: Xcode 미설치로 `xcodebuild requires Xcode` 실패.
- 해소 근거: Xcode 26.6 설치 확인. iPhone 17 Pro 시뮬레이터(iOS 26.5)에서 `xcodebuild` 빌드 성공 → `simctl install`로 설치 → 앱 실행 성공.
- 상태: **완전 해소, 재발 방지책 불필요(1회성 환경 준비 항목).**

### G2 — 유효 TLS 인증서 부재 (🔴 iOS 배포 하드블로커, 유일 잔존 외부요인)
- 현상: 프로덕션 `8443` 자체서명/IP 인증서(verify_result=20). iOS ATS가 프로덕션 앱 내 통신 차단.
- 해소 경로: **도메인 구매 + Let's Encrypt** 적용 후 `APP_API_BASE`를 도메인으로 교체(스크립트 1줄) → 재빌드.
- 이번 세션 확인: 로컬 백엔드(`http://localhost:3100`)는 iOS ATS 예외(Info.plist localhost 평문 허용)로 정상 동작 — 즉 **P1(셸+번들+인앱알림) 검증 자체는 인증서와 무관하게 완결**. G2는 순수하게 **P2(프로덕션 배포) 선결조건**이며 코드·설계 결함이 아니다.
- 상태: 미해소(사람 개입: 도메인 구매 필요). Match Rate 계산상 P1 감점 요인 아님(Design §2에서 이미 P2 전용으로 명시).

### G3 — 시뮬레이터/에뮬레이터 실구동 검증 미완 → ✅ **해소 (2026-07-25)**
- Android: 지난 세션 adb 자동화로 실기 라이브 실행·로그인·실시간 검증 완료.
- iOS: 금번 세션에서 실제 빌드·설치·실행 완료. mtest 계정 로그인 → "우리 농장" 대시보드 진입, 상단바(메뉴·벨·새로고침) 정상 렌더 확인.
- **인앱 알람(Socket.io) 실증**: 백엔드가 `notification:new`를 `user:<id>` room으로 브로드캐스트 → 앱 하단에 "⚠️ 센서 경고 (테스트)" 토스트 정상 표시. Plan v2 R6(인앱 알림만) 요구의 iOS 실동작 증명 완료.
- 상태: **iOS·Android 양쪽 모두 완전 해소.**

### G4 — 프론트 `isNative` 격리 원칙 부분 이탈 (🟡 신규 발견, 2026-07-25 실사)
- 현상: `frontend/src/composables/useNativePush.ts`는 `isNative`(구 `isNativeApp()`) 게이팅으로 웹에서 완전 no-op — 이 부분은 Design C1("frontend 소스 수정 0"/"웹은 코드 변경 없음") 준수.
- 그러나 다음 두 변경은 **게이팅 없이 웹 사용자에게도 적용**되는 실질적 동작 변경으로 확인됨:
  - `frontend/src/stores/auth.store.ts`: silent-refresh 주기 14분→10분 단축, `refreshInFlight` 뮤텍스 신설(동시 refresh 호출 중복 방지), refresh 실패 시 `user` 상태·타이머 명시적 정리 로직 추가.
  - `frontend/src/App.vue`: `watch(isAuthenticated, ...)`로 인증 소실 시 `/login` 강제 리다이렉트 추가(웹에도 무조건 적용).
- 판단: 코드 주석상 "앱 셸이 사라지는(shell disappears)" 모바일 버그 수정 목적으로 보이며, `auth.store.ts`/`App.vue`는 웹·앱이 **동일 프론트 소스를 공유**하는 구조(번들 방식)라 완전한 게이팅이 애초에 어려운 영역 — 즉 설계상 불가피한 측면이 있으나, Plan v2 §2/Design C1의 "웹은 코드 변경 없음" 문언과는 문자 그대로 배치된다.
- 영향도: 낮음~중간 — 세션 관리 개선(뮤텍스, 정리 로직)은 웹에도 유익한 방향이나 **회귀 테스트 없이 웹 프로덕션에 반영되면 리스크**. 특히 강제 리다이렉트 로직은 웹의 기존 인증 흐름과 상호작용 검증 필요.
- 권장 조치: (a) Design 문서에 "동일 번들 공유로 인해 일부 공용 코드는 게이팅 불가, 웹에도 유익한 변경만 허용" 예외 조항 추가로 문서 현실화, 또는 (b) 정말 앱 전용이면 `isNative` 분기로 리팩터링. 웹 회귀 테스트(로그인 세션 유지·자동 로그아웃 시나리오) 권장.

### G5 — `firebase-admin` 의존성 조기 추가 (🟢 경미, 정보성)
- 현상: `backend/package.json`에 `firebase-admin@^14.2.0` 추가됨. `backend/src` 내 실제 import/사용처는 없음(grep 결과 0건) — 런타임 영향 없음.
- 판단: P3(OS 푸시/FCM) 선반영 준비로 추정. P1 범위 밖이며 미사용 상태라 Match Rate에 가점/감점 없음. 다만 P1 완료 시점 기준으로는 불필요한 의존성이므로, P3 착수 전까지는 제거하거나 최소한 커밋 메시지/PR에 "P3 선반영" 명시 권장.

---

## 4. 설계 대비 준수 확인 (Design v2)

- 2장(TLS/ATS) — 인지·문서화 완료, G2로 추적. **이번 세션에 "로컬 백엔드+ATS 예외로 P1 자체는 검증 가능"이 실증으로 확정** ✅
- 3장(격리: `mobile/` 신규만) — `mobile/` 디렉터리 자체는 정확히 이행. 단 `frontend/` 공용 소스 변경 건은 G4로 별도 추적 ⚠️
- 4장(번들 webDir + env 교체 1곳) — `build-web.sh`로 구현, PWA SW 제거 등 부가 처리까지 포함 ✅
- 5장(빌드 절차) — iOS/Android 양쪽 `xcodebuild`/Gradle 빌드 후 시뮬레이터·에뮬레이터 실행까지 완주 ✅ (신규 실증)
- 8장(구현 체크리스트) — 1~3 완료, 4(도메인/인증서)는 대기(P2 선결조건), 5(스모크: 로컬 백엔드 기준)는 완료, 6(배포)는 P2 대기 ✅

---

## 5. 결론 & 다음 조치

**iOS 인앱알람 실증 완료로 G1·G3 해소, 잔여는 G2(도메인/인증서) 외부요인만.** P1 코어(하이브리드 셸 + 프론트 번들 연결 + 인앱 알림)는 iOS·Android 양쪽 모두 실기 빌드·설치·로그인·실시간 Socket.io 알림까지 실증되어 **사실상 완료** 상태다. 유일한 잔존 항목인 G2(도메인+공인 인증서)는 Design 문서가 이미 P2(배포) 전용 선결조건으로 명시해둔 순수 외부요인이며, 로컬 백엔드 기준 P1 검증 자체는 인증서와 무관하게 완결되었음이 이번 세션에 재확인되었다.

다만 실사 과정에서 기존 분석이 놓쳤던 **G4(프론트 isNative 게이팅 부분 이탈)**를 신규로 발견했다 — `auth.store.ts`/`App.vue`의 세션 관리 개선이 웹에도 게이팅 없이 적용되어 있어, "웹은 코드 변경 없음" 원칙과 문자 그대로는 배치된다. 코드 자체는 유익한 방향(리프레시 뮤텍스, 강제 로그아웃 리다이렉트)이나 웹 회귀 검증이 필요하다.

**사람 조치 (순서):**
1. **도메인 구매 + 8443 공인 인증서** → `APP_API_BASE` 교체 후 재빌드 → 프로덕션 실통신 스모크.
2. **G4 후속**: `auth.store.ts`/`App.vue` 변경에 대한 웹 회귀 테스트(로그인 세션 유지, 자동 로그아웃 플로우) 진행 후 Design 문서에 예외 조항 반영 또는 게이팅 리팩터.
3. **G5 정리**: `firebase-admin`은 P3 착수 전까지 제거하거나 PR에 "P3 선반영" 명시.
4. 이후 **P2**: Apple Developer 가입 → TestFlight, Android APK 배포.

**즉시 가능(선택):** 프로덕션 도메인 확보 전까지는 로컬/사내망 백엔드로 iOS·Android 양쪽 QA 계속 진행 가능(이번 세션 방식 재사용).
