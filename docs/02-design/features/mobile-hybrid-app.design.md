# Design: mobile-hybrid-app

> Date: 2026-07-18 | Updated: 2026-07-23 | Plan: `docs/01-plan/features/mobile-hybrid-app.plan.md`
> Scope: **P1(셸 구축) 상세 설계** + P2~P5 인터페이스 정의. 기존 서비스 무영향 원칙.

> ### ⚠️ 방식 정정 (v2 정합, 2026-07-23)
> 본 문서 초안(v1)은 **원격 URL 로드** 방식이었으나, 이후 **Plan v2(2026-07-20)** 에서
> **번들 내장 + 인앱 알림만 + 백엔드 무변경**으로 방향이 확정되었다. **Plan v2가 방식의 최종 기준(design-of-record)** 이다.
> - C2/1장/4장의 "원격 URL(`server.url`)" 서술은 **번들 내장**으로 대체됨.
> - 앱은 `frontend` 빌드 산출물을 `mobile/www` 에 번들 → 오프라인 초기 로드, API/WS 는 원격 백엔드 호출.
> - API/WS 주소는 **빌드타임 env(`VITE_API_URL`/`VITE_WS_URL`) 주입**만으로 처리 → **frontend 소스 무변경**.
> - 아래 2장(TLS/ATS), 3장(격리), 5장(빌드절차), 6~8장(단계·리스크·체크리스트)은 **v2에서도 유효**.
> - OS푸시(APNs/FCM)·위젯은 v2에서 **현 스코프 제외**(추후 별도). 인앱 알림(Socket.io)만 유지.

---

## 0. 설계 대전제 (Constraints)

| # | 제약 | 설계 반영 |
|---|------|-----------|
| C1 | **기존 서비스 무영향** — 데스크톱 웹 계속 테스트 중 | 신규 `mobile/` 디렉터리로 완전 격리. `frontend/`·`backend/` 소스 **수정 0**. 추가만 |
| C2 | 프레임 안 내용 = **프로덕션 웹서비스** | Capacitor **원격 URL 로드** 방식(번들 내장 아님). 앱은 얇은 셸 |
| C3 | 프로덕션 주소 = `https://175.206.245.234:8443` | base URL을 **단일 설정값**으로 관리 |
| C4 | **도메인 조만간 구매 예정** | URL 교체가 1줄로 끝나도록 env 기반 설계 |
| C5 | 앱 개발은 이 개발 노트북(M1)에서 | 빌드 툴체인은 로컬, 런타임 대상은 원격 프로덕션 |

---

## 1. 아키텍처 개요

```
┌─────────────────── iOS / Android App (Capacitor 셸) ───────────────────┐
│  Native Layer (Swift/Kotlin)                                           │
│   ├─ WKWebView / Android WebView                                       │
│   │     └─ 원격 로드: https://app.smartfarm.example (프로덕션 웹)       │  ← C2
│   ├─ Push plugin (APNs / FCM)          [P3]                            │
│   └─ Widget extension (WidgetKit/AppWidget) [P5]                       │
└────────────────────────────┬──────────────────────────────────────────┘
                             │ HTTPS (유효 TLS 필수 — ATS)
                             ▼
        프로덕션 서버 175.206.245.234 (→ 도메인 예정) :8443
        [기존 Vue 프론트 + NestJS 백엔드 + Socket.io]   ← 수정 없음
```

- 웹 화면·로직·실시간(Socket.io)은 **프로덕션이 그대로 서빙** → 앱은 렌더 셸 + 네이티브 브릿지만 담당.
- 앱 업데이트 없이 웹 배포만으로 화면 갱신됨(사실상 상시 OTA). 네이티브 기능 변경만 스토어 재제출.

---

## 2. 🔴 핵심 선결과제: TLS 인증서 (iOS ATS / Android Network Security)

**현황 진단** (2026-07-18 실측):
- `https://175.206.245.234:8443` → HTTP 200 응답 OK, 그러나 **TLS 검증 실패(verify_result=20, 자체서명/불완전 체인 추정)**.

**문제:**
- iOS는 **App Transport Security(ATS)** 로 앱의 모든 네트워크 연결에 **공인 유효 TLS**를 강제. WKWebView는 자체서명 인증서 예외 처리가 사실상 불가(우회 시 앱스토어 반려).
- **IP 주소로는 공인 인증서 발급이 어려움.** → 도메인이 필요.
- 이 규칙은 WebView뿐 아니라 **API 호출·WebSocket(wss)** 에도 동일 적용 → 번들 방식으로 바꿔도 동일하게 필요.

**결론 / 필수 순서:**
1. **도메인 구매** (예: `smartfarm.example`) → 서브도메인 `app.smartfarm.example`을 175.206.245.234로 A레코드 연결.
2. 프로덕션 8443에 **Let's Encrypt 등 공인 인증서** 적용 (nginx/reverse proxy).
3. 앱 base URL = `https://app.smartfarm.example:8443` (또는 443 리다이렉트).
4. 인증서 유효화 후 iOS·Android 모두 예외 설정 없이 정상 동작.

**도메인 확보 전 임시 개발 경로 (프로덕션 무영향):**
- iOS 시뮬레이터 한정 `Info.plist`에 **개발용 ATS 예외**(`NSAllowsArbitraryLoads`) → **프로덕션 빌드에는 절대 미포함**(별도 빌드 스킴/Debug 전용).
- 또는 로컬 개발 중엔 개발용 프론트(`localhost:5173`)로 셸 동작만 검증하고, 실제 프로덕션 연결 검증은 인증서 적용 후 진행.

> ⚠️ 이 항목이 **P2(배포)의 하드 블로커**. P1 셸 구축은 이와 무관하게 진행 가능.

---

## 3. 격리 전략 (C1 — 기존 서비스 무영향)

### 3-1. 디렉터리 구조 (신규 추가만)
```
smart-farm-mqtt/
├── frontend/          # 기존 — 수정 없음
├── backend/           # 기존 — 수정 없음 (P3 푸시 때만 신규 파일 추가)
└── mobile/            # ★ 신규 — Capacitor 셸 프로젝트 (완전 격리)
    ├── capacitor.config.ts
    ├── package.json
    ├── .env.example        # APP_URL 등
    ├── www/                # 최소 부트스트랩 페이지(리다이렉트/스플래시)
    ├── ios/                # npx cap add ios 산출물 (gitignore 선택)
    └── android/            # npx cap add android 산출물
```
- `mobile/`는 독립 `package.json` → 루트/`frontend` 의존성과 분리. 데스크톱 테스트 빌드에 전혀 개입 안 함.
- 기존 `docker-compose`, 배포 스크립트 무변경.

### 3-2. Git 전략
- 신규 파일만 추가 → 기존 파일 diff 0.
- `mobile/ios/`, `mobile/android/`의 대용량 네이티브 산출물은 `.gitignore` 후 `npx cap sync`로 재생성 가능하게(선택).
- 작업은 별도 브랜치(`feature/mobile-hybrid-app`)에서 진행 후 병합 → main의 데스크톱 테스트에 무영향.

---

## 4. Capacitor 설정 (P1)

### 4-1. `mobile/capacitor.config.ts` — 원격 URL + env 기반 (C3/C4)
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

// 단일 진실 원천: 여기(또는 .env)만 바꾸면 IP→도메인 교체 완료
const APP_URL = process.env.APP_URL ?? 'https://175.206.245.234:8443';

const config: CapacitorConfig = {
  appId: 'com.smartfarm.app',
  appName: 'SmartFarm',
  webDir: 'www',                 // 최소 부트스트랩(원격 로드 전 스플래시)
  server: {
    url: APP_URL,                // ★ 프레임 안 = 프로덕션 웹 (C2)
    cleartext: false,            // HTTPS 강제
    allowNavigation: [
      '175.206.245.234',
      'app.smartfarm.example',   // 도메인 확정 후 추가
    ],
  },
  ios: { contentInset: 'always' },
  android: { allowMixedContent: false },
};

export default config;
```

### 4-2. 도메인 교체 절차 (C4) — 1곳 변경
1. `.env`의 `APP_URL`을 `https://app.smartfarm.example`로 변경.
2. `server.allowNavigation`에 도메인 추가(위에 이미 준비).
3. `npx cap sync` → 재빌드. **웹/백엔드 코드 변경 없음.**

### 4-3. 최소 부트스트랩 `www/index.html`
- 원격 로드 전 잠깐 표시될 스플래시 + 오프라인/연결실패 시 안내. (WebView-only 반려 위험 완화용 네이티브 요소는 P3 푸시로 충족)

---

## 5. 빌드 & 실행 절차 (P1, 무료 계정 범위)

```bash
# 1) 프로젝트 생성 (mobile/ 안에서)
cd mobile
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init SmartFarm com.smartfarm.app --web-dir=www

# 2) 플랫폼 추가
npx cap add ios
npx cap add android

# 3) 동기화 & 실행
npx cap sync
npx cap open ios       # Xcode → 시뮬레이터 실행
npx cap open android   # Android Studio → 에뮬레이터 실행
```

**전제 도구:** Xcode(+CocoaPods), Android Studio(+SDK 2.7GB 유지). 디스크 36GB 확보 완료.

**P1 완료 판정(DoD):** 시뮬레이터/에뮬레이터에서 프레임 안에 프로덕션 로그인 화면이 뜨고, (인증서 유효화 후) 로그인→대시보드→제어까지 동작.

---

## 6. 네이티브 기능 최소셋 & 이후 단계 인터페이스

### P3 — 푸시 (APNs+FCM) *(설계 개요, 별도 상세는 P3 진입 시)*
- 앱: `@capacitor/push-notifications` → 디바이스 토큰 획득.
- 백엔드: `backend/src/modules/notifications/`에 **신규 파일만 추가** (기존 무영향):
  - `POST /notifications/device-token` (토큰 등록)
  - APNs/FCM 발송 어댑터 → 기존 알림 이벤트(sensor-alerts, 작업완료, 자동화결과)에 훅.
- 알림 정책: 웹 알림센터와 동일하게 error/warning + 60초 dedup 유지(중복 발송 방지).

### P4 — OTA
- 원격 URL 방식이라 **웹 배포 = 즉시 반영**(별도 OTA 도구 불필요할 수 있음). 번들 방식 전환 시에만 `@capgo/capacitor-updater` 도입 검토.

### P5 — 위젯
- iOS WidgetKit(Swift) + Android AppWidget(Kotlin). 앱↔위젯 데이터는 App Group / SharedPreferences. 완료 상태를 푸시(P3)로 위젯 타임라인 갱신.

---

## 7. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 🔴 자체서명/IP 인증서로 iOS ATS 차단 | iOS 실기기·배포 불가 | **도메인+공인 인증서**가 P2 선결. 개발 중엔 Debug 전용 ATS 예외(프로덕션 미포함) |
| WebView-only 앱 애플 반려(4.2) | iOS 심사 실패 | P3 푸시 등 네이티브 기능 포함, 스플래시/오프라인 처리 |
| Socket.io가 wss로 안 붙음 | 실시간 끊김 | 인증서 유효화 시 자동 해결. `allowNavigation`에 도메인 포함 |
| 8443 비표준 포트 문제 | 일부 네트워크 차단 | 도메인 적용 시 443 리다이렉트 권장 |
| 웹 localStorage 토큰의 앱 보안 | 인증정보 노출 | 원격 URL 방식이라 웹과 동일. 필요 시 네이티브 보안저장 브릿지 검토 |
| mobile/ 산출물이 CI/배포에 끼어듦 | 기존 배포 오염 | `mobile/`는 배포 파이프라인에서 제외. 독립 빌드 |

---

## 8. 구현 순서 체크리스트 (→ `/pdca do mobile-hybrid-app`)

1. [ ] `mobile/` 디렉터리 + Capacitor 초기화 (기존 파일 무변경 확인)
2. [ ] `capacitor.config.ts` 원격 URL(env) 설정
3. [ ] `npx cap add ios/android` + 시뮬레이터 부팅
4. [ ] (병행) 도메인 구매 + 8443 공인 인증서 적용 → ATS 통과 확인
5. [ ] 프로덕션 연결로 로그인~제어 스모크 테스트
6. [ ] P2: Apple Developer 가입 → TestFlight / Android APK 배포

---

## 관련 문서
- Plan: `docs/01-plan/features/mobile-hybrid-app.plan.md`
- 알림 정책 참고: 웹 알림센터 error/warning + 60초 dedup
- 배포 참고: 프로덕션은 맥미니 `smartfarm` 서비스와 동거(CLAUDE.md 프로덕션 서버 섹션)
