# Plan — mobile-hybrid-app (Capacitor 하이브리드 + 인앱 알림 + 도메인 구매)

**Feature**: mobile-hybrid-app
**Created**: 2026-07-18 (초안 v1: 푸시·위젯 포함)
**Updated**: 2026-07-20 (v2: **인앱 알림만 / 백엔드 무변경 원칙 / 도메인 구매 추가**)
**Owner**: 오정석
**Phase**: Plan (참고 문서)

---

## 0. 이번 개정 요약 (v2, 2026-07-20)

기존 v1 은 FCM/APNs OS 푸시 + 홈화면 위젯까지 포함한 풀 스택 계획이었다.
2026-07-20 결정으로 **스코프를 다음과 같이 축소**한다:

- ✅ **하이브리드 셸** (Capacitor) — 유지
- ✅ **인앱 알림만** — 앱 실행 중 WebView 안에서 뜨는 토스트/벨 (기존 웹 방식 그대로)
- ❌ **OS 푸시(FCM/APNs)** — 제외 (앱 꺼져있을 때 알림 없음, 사용자 수용)
- ❌ **홈화면 위젯** — 별도 기획으로 보류
- ✅ **도메인 구매** — 신규 추가 (앱 스토어 심사·HTTPS·이메일 등 필수 인프라)
- ✅ **백엔드 무변경 원칙** — 웹 서비스에 영향 0

**핵심 목표**: 데스크톱 브라우저 + 모바일 브라우저 + iOS 앱 + Android 앱, **네 클라이언트를 하나의 백엔드 하나의 프론트 코드베이스로** 서비스.

---

## 1. 배경 (Why)

- 기존 Vue 3 SPA 는 데스크톱/모바일 브라우저에서 잘 동작 중 (홈화면 단축아이콘 형태로도 사용)
- 다음 단계: **앱 스토어(TestFlight) 초대 배포** 로 브라우저 없이 앱 아이콘으로 열 수 있게
- 그러나 지금 시점에 OS 푸시·위젯까지 도입하면 리팩터 리스크 큼 → **최소 구성으로 앱화만 우선**
- IP 주소 기반 접속(`175.206.245.234:8443`) 대신 **도메인 사용** 필수 (앱 심사·SSL·사용자 신뢰)

---

## 2. 최종 방향 (2026-07-20 결정)

### 채택 방식
- **Capacitor WebView 하이브리드** — 기존 Vue 빌드 산출물을 WebView 안에 담아 iOS/Android 앱화
- **인앱 알림 only** — Socket.io + `notification.store` 그대로 사용, OS 알림 트레이 팝업 X
- **번들 내장** — 앱 첫 실행 시 오프라인 로드 가능, API 는 원격 백엔드로

### 백엔드 변경 원칙
- **웹 서비스 사용자에게 영향 0** — 스키마·API 응답·WebSocket 페이로드 변경 금지
- **추가는 OK, 변경/삭제는 X**
- 유일하게 손볼 곳: CORS origin 배열, 로그인 API refresh token body 반환 옵션

### 프론트 변경 원칙
- 웹은 코드 변경 없음 (`isNative` 로 앱 전용 코드 분기)
- 앱 어댑터는 `composables/useNativeShell.ts` 신설로 격리

---

## 3. 도메인 계획 (신규)

### 3.1 왜 도메인이 필요한가

| 이유 | 상세 |
|---|---|
| **앱 스토어 심사** | Apple/Google 은 IP 주소 서비스에 심사 부정적 (프라이버시 정책·지원 URL·EULA 필수) |
| **HTTPS 신뢰성** | Let's Encrypt SSL 은 도메인 필수. 사용자 브라우저에 자물쇠 표시 |
| **iOS SameSite=Lax 쿠키** | HTTPS + 도메인 조합에서 refresh token 쿠키 안정 동작 |
| **딥링크 (Universal Links)** | iOS 앱 심사에서 `apple-app-site-association` 파일 호스팅 필요 |
| **이메일 도메인** | 앱 스토어 개발자 연락처·프라이버시 정책 페이지에 `contact@도메인` 신뢰도 |
| **사용자 UX** | `smartfarm.xxx.com` 이 IP 보다 기억·공유 쉬움 |

### 3.2 등록업체 후보

| 업체 | 가격 (.com/년) | 장점 | 단점 |
|---|---|---|---|
| **Cloudflare Registrar** | ~$9.15 (원가) | 마진 0, DNS·SSL·CDN 무료 통합 | UI 단순, 국내 지원 X |
| **Namecheap** | ~$8.88 (첫해) | Whois 프라이버시 무료, 사용성 좋음 | 갱신비 ~$14, DNS 별도 |
| **Gabia** | ~15,000원 (첫해) | 국내 업체, 원화 결제, 한국어 지원 | 갱신비 비쌈 (~30,000원+) |
| **Namesilo** | ~$8.99 (매년 동일) | 갱신비 인상 없음, WHOIS 프라이버시 무료 | UI 투박 |

**추천**: **Cloudflare Registrar** — 원가 판매, DNS 관리·SSL·프록시 무료 통합. 국내 결제만 카드로 처리 가능.
차선: Namesilo (갱신비 안정).

### 3.3 도메인 네이밍

- 후보 예시 (사용자 결정 필요):
  - `smartfarm-io.com` / `smartfarm.kr` / `hkfarm.co.kr` / `sffarm.io` 등
  - 짧고 기억 쉬움, .com 우선 (앱 스토어 표준화)
- **결정 필요 사항**:
  - 개인 브랜드형 vs 서비스형
  - TLD 선호 (.com > .io > .kr > .co.kr)
  - 백업 도메인 확보 여부 (오타·유사 도메인 방어)

### 3.4 서브도메인 설계 (권장)

| 서브도메인 | 용도 | 예 |
|---|---|---|
| `app.smartfarm-io.com` | 프론트엔드 (Vue SPA) | 사용자 접속 URL |
| `api.smartfarm-io.com` | 백엔드 API + WebSocket | fetch/socket.io 대상 |
| `mqtt.smartfarm-io.com` | Mosquitto (선택, TLS 지원 시) | 라즈베리파이 연결 |
| `www.smartfarm-io.com` | `app.` 로 redirect | SEO/편의 |
| `smartfarm-io.com` (루트) | 랜딩 페이지 (선택) 또는 `app.` redirect | — |

**심플 접근** (초기): 단일 도메인 사용
- `smartfarm-io.com` — 프론트
- `smartfarm-io.com/api` — 백엔드 (Nginx 프록시)
- 서브도메인 없이 하나로 통합, 나중에 분리 가능

**분리 접근** (확장성): 위 표대로 서브도메인 분리
- CORS·쿠키 도메인 관리 별도 필요

### 3.5 DNS 레코드 (예시)

```
A     smartfarm-io.com         → mac mini 공인 IP (또는 CloudFront/Cloudflare 프록시)
A     app.smartfarm-io.com     → 같은 IP (또는 프론트 전용 CDN)
A     api.smartfarm-io.com     → 같은 IP
CNAME www.smartfarm-io.com     → smartfarm-io.com
MX    smartfarm-io.com         → (이메일 사용 시, Gmail Workspace 등)
TXT   smartfarm-io.com         → SPF/DKIM (이메일 발송 시)
CAA   smartfarm-io.com         → letsencrypt.org (SSL 발급 제한)
```

### 3.6 SSL/HTTPS

- **Let's Encrypt** (무료) + **certbot** 으로 mac mini 에 자동 갱신
- 또는 Cloudflare 프록시(오렌지 구름) 사용 시 SSL 자동 (Full/Strict 모드)
- Nginx 설정에 `ssl_certificate` 지정
- 60일 자동 갱신 cron

### 3.7 앱 스토어 심사 필수 페이지

- **프라이버시 정책**: `https://smartfarm-io.com/privacy`
- **이용약관**: `https://smartfarm-io.com/terms`
- **지원 연락처**: `contact@smartfarm-io.com` 또는 지원 URL
- **Apple Universal Links** (선택, 딥링크 시): `https://smartfarm-io.com/.well-known/apple-app-site-association`
- **Android App Links** (선택): `https://smartfarm-io.com/.well-known/assetlinks.json`

---

## 4. 아키텍처

```
┌─ 모든 클라이언트 ──────────────────────────────┐
│                                                  │
│  데스크톱     모바일     iOS 앱      Android 앱   │
│  브라우저     브라우저   (Capacitor)  (Capacitor) │
│      │           │           │           │        │
│      │           │           │           │        │
│      └───────────┴───────────┴───────────┘        │
│                      │                            │
│                      ▼                            │
│      https://app.smartfarm-io.com                 │
│      https://api.smartfarm-io.com                 │
│                      │                            │
└──────────────────────┼────────────────────────────┘
                       ▼
┌─ mac mini (server) ─────────────────────────────┐
│  Nginx (SSL termination, reverse proxy)          │
│    ├─ / → frontend/dist (Vue 정적)              │
│    ├─ /api → backend :3100                      │
│    ├─ /socket.io → backend :3100                │
│    └─ /.well-known/* → 앱 링크 파일             │
│                                                  │
│  NestJS backend :3100  +  Socket.io              │
│  PostgreSQL :5432 (TimescaleDB)                  │
│  Redis :6379 + Bull queue                        │
│  Mosquitto :1883 (Zigbee 게이트웨이용)           │
└──────────────────────────────────────────────────┘
```

- **하나의 Vue 빌드** 를 모든 클라이언트가 사용
- iOS/Android 앱은 그 빌드를 번들 내장 → 오프라인 초기 로드, API 는 원격
- WebSocket 은 앱에서도 그대로 (`ws.smartfarm-io.com` 없이 api 통합)

---

## 5. 백엔드 최소 변경사항

### 5.1 CORS origin 배열 확장

```typescript
// backend/src/main.ts
app.enableCors({
  origin: [
    process.env.CORS_ORIGIN,             // https://app.smartfarm-io.com
    'capacitor://localhost',              // iOS WebView
    'http://localhost',                   // Android WebView
    'https://smartfarm-io.com',           // 루트 (선택)
  ],
  credentials: true,
})
```

### 5.2 로그인 응답에 refresh token body 옵션 (앱 전용)

- iOS WebView 의 SameSite=Lax httpOnly 쿠키 정책 대응
- 앱은 `X-Client: ios-app|android-app` 헤더 보내면 body 에 refresh token 도 반환
- 웹은 지금대로 쿠키만 (body 무시)

```typescript
// auth.controller.login()
res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS)
const isApp = req.headers['x-client']?.toString().endsWith('-app')
return {
  accessToken: result.accessToken,
  refreshToken: isApp ? result.refreshToken : undefined,  // 앱만
  user: result.user,
}
```

### 5.3 활동 로그에 클라이언트 종류 (선택)

- 사용자 액션 로그에 `X-Client` 헤더 저장 → 통계용
- 로직 분기 X

**그 외 변경 없음** — DB 스키마·API 응답 필드·WebSocket 이벤트 모두 그대로.

---

## 6. 프론트 어댑터 (앱 전용, 웹 무영향)

### 6.1 `composables/useNativeShell.ts` (신규)

```typescript
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'

export const isNative = Capacitor.isNativePlatform()

export async function initNativeShell(router: Router) {
  if (!isNative) return   // 웹은 no-op

  // 상태바
  await StatusBar.setStyle({ style: Style.Light })

  // 스플래시 해제
  await SplashScreen.hide()

  // 뒤로가기
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) router.back()
    else App.exitApp()
  })

  // 백그라운드 복귀 시 소켓 재연결
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) reconnectSocket()
  })
}
```

### 6.2 auth.store 저장소 어댑터

```typescript
// stores/auth.store.ts — accessToken 저장 부분
async function persistToken(token: string) {
  if (isNative) {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: 'access', value: token })
  }
  // 웹은 메모리만 (현재 정책 유지)
}
```

### 6.3 API base URL

```typescript
// api/client.ts
const baseURL = isNative
  ? 'https://api.smartfarm-io.com'
  : (import.meta.env.VITE_API_URL || '/api')
```

---

## 7. Capacitor 셸 설정

### 7.1 프로젝트 초기화

```bash
cd frontend
npm install @capacitor/core @capacitor/cli
npx cap init "스마트팜" com.smartfarm.app --web-dir=dist
npm install @capacitor/ios @capacitor/android
npm install @capacitor/app @capacitor/preferences @capacitor/status-bar @capacitor/splash-screen
npx cap add ios
npx cap add android
```

### 7.2 `capacitor.config.ts`

```typescript
export default {
  appId: 'com.smartfarm.app',
  appName: '스마트팜',
  webDir: 'dist',
  server: {
    // 초기 개발 중엔 원격 접속 (핫리로드용):
    // url: 'https://app.smartfarm-io.com',
    // 프로덕션 빌드는 번들 내장 (server 블록 제거)
    androidScheme: 'https',
  },
  ios: { contentInset: 'automatic' },
  plugins: {
    SplashScreen: { launchShowDuration: 1500 },
  },
}
```

### 7.3 iOS 필수 설정

- `Info.plist`: `NSAppTransportSecurity` 는 기본값 유지 (HTTPS 도메인이라 예외 불필요)
- `Info.plist`: 카메라·마이크·위치 등 사용 시 usage description 문구
- App Icon / Splash: 1024×1024 원본 → `@capacitor/assets` 로 자동 생성
- Universal Links (선택): `Associated Domains` capability 추가

### 7.4 Android 필수 설정

- `AndroidManifest.xml`: `INTERNET` 권한 기본 포함
- `network_security_config.xml`: HTTPS 강제 (production)
- App Icon / Splash: 위와 동일 도구
- App Links (선택): `intent-filter` + verification

---

## 8. 배포 파이프라인

### 8.1 웹 배포 (기존)

- `frontend build → dist/ → Nginx serve` — 지금 그대로
- 도메인 반영 후 Nginx 서버 블록에 `server_name app.smartfarm-io.com` 추가

### 8.2 iOS 배포 (신규)

1. Apple Developer 계정 ($99/년) 등록
2. Xcode 에서 `npx cap open ios` → Archive → App Store Connect 업로드
3. **TestFlight** — 이메일/링크 초대 (내부 100명, 외부 최대 10,000명)
4. 정식 App Store 출시는 후속 별도

### 8.3 Android 배포 (신규)

1. **초기**: APK 빌드해서 직접 전달 (계정 불필요, 안드로이드는 사이드로딩 가능)
2. **확장 시**: Google Play Console ($25 일회성) → 내부 테스트 트랙
3. Android Studio 에서 `npx cap open android` → Build → APK

### 8.4 OTA 업데이트 (선택, 후속)

- 웹 변경 시 스토어 재심사 없이 반영
- `@capgo/capacitor-updater` (무료 오픈소스) 검토
- 첫 배포엔 도입 X (앱 안정화 후)

---

## 9. 단계별 로드맵

| 단계 | 산출물 | 선행 조건 | 예상 소요 |
|---|---|---|---|
| **S1. 도메인** | 도메인 등록, DNS 설정, SSL 발급, Nginx 도메인 서버블록 | 등록업체·이름 결정 | 1일 |
| **S2. 심사 필수 페이지** | privacy, terms, contact 페이지 | 도메인 완료 | 반나절 |
| **S3. 백엔드 최소 변경** | CORS 확장, refresh token body 옵션 | 도메인 완료 | 반나절 |
| **S4. 프론트 어댑터** | `useNativeShell`, auth.store 분기, api baseURL | S3 완료 | 1일 |
| **S5. Capacitor 셸** | iOS/Android 프로젝트 생성, 필수 플러그인 4개 | S4 완료 | 1일 |
| **S6. iOS 시뮬레이터 검증** | 로그인·대시보드·소켓 통신 확인 | S5 완료 | 1일 |
| **S7. Android 에뮬레이터 검증** | 동일 확인 | S6 완료 (같이 가능) | 1일 |
| **S8. Apple Developer 등록** | $99, iOS 실기기 배포 준비 | S6 통과 | 3~7일 대기 |
| **S9. TestFlight 초대 배포** | 실기기에서 초대 링크로 설치·사용 | S8 완료 | 1일 |
| **S10. Android APK 전달** | 실기기 사이드로딩 배포 | S7 통과 | 반나절 |

**총 예상**: 2주 (Apple Developer 승인 대기 제외)

---

## 10. 비용 정리

| 항목 | 비용 | 주기 |
|---|---|---|
| 도메인 (.com, Cloudflare) | ~$9.15 | 년 |
| SSL (Let's Encrypt) | 무료 | 자동 갱신 |
| Apple Developer Program | $99 | 년 |
| Google Play Console | $25 | 1회 (초기 APK 배포엔 불필요) |
| FCM/APNs (미사용) | — | — |
| OTA (Capgo 무료) | 무료 | 초기 미사용 |
| **첫해 총 고정비** | **약 $108 (약 15만원)** | — |

---

## 11. 리스크 & 대응

| # | 리스크 | 확률 | 대응 |
|---|---|---|---|
| 1 | Apple 심사 "순수 WebView 반려" (`4.2 Minimum Functionality`) | 중 | 인앱 알림 외 최소 네이티브 기능 (Preferences, StatusBar, SplashScreen, backButton) 4개 이상 포함으로 근거 확보 |
| 2 | iOS WebView 의 SameSite refresh 쿠키 이슈 | 중 | 5.2 대응 (앱 로그인 응답 body 로 refresh token 반환) |
| 3 | Socket.io 백그라운드 sleep 시 끊김 | 상 | 앱 포그라운드 복귀 시 자동 재연결 + `sensor_alerts` 조회로 hydrate |
| 4 | 도메인 DNS 전파 지연 (최대 48h) | 하 | 사전 DNS 변경 후 대기, 발급 실패 대비 |
| 5 | HTTPS 인증서 갱신 실패 (60일 후) | 하 | certbot cron + 모니터링 알림 |
| 6 | Nginx 프록시 설정 오류로 API 응답 지연 | 중 | 개발/스테이징 도메인 먼저 검증 |
| 7 | 사용자가 앱 삭제·재설치 시 로컬 토큰 소실 | 하 | refresh token 저장으로 자동 재로그인 |
| 8 | 웹 접속자가 앱 스토어 심사 정책으로 잘못 안내됨 | 하 | 프라이버시 정책은 사용자 대상 명확 문구 사용 |

---

## 12. 웹 서비스 무영향 보장 규칙

**절대 규칙**:
1. 백엔드 API 응답 스키마 **변경 금지** (추가는 OK)
2. WebSocket 이벤트 페이로드 **변경 금지**
3. CORS 는 origin 배열에 앱 origin **추가만**
4. 데이터베이스 스키마 **변경 없음** (인앱 알림은 새 테이블 불필요)
5. 프론트 어댑터는 `isNative` 로 분기 → 웹은 기존 경로 그대로
6. 도메인 전환 시 IP 접속도 병행 유지 (Nginx `server_name` 에 IP 도 포함)

---

## 13. Out of Scope (향후 별도 기획)

- **OS 푸시 알림 (FCM/APNs)** — 앱이 꺼져있어도 알림 수신, 필요 시 `notification-taxonomy.plan.md` 그대로 이식
- **홈화면 위젯** (iOS WidgetKit / Android App Widget) — 순수 네이티브 개발 필요
- **Live Activity / 다이나믹 아일랜드** — iOS 위젯 이후
- **OTA 라이브 업데이트** (Capgo/Appflow) — 앱 안정화 후
- **인앱결제** — 해당 없음
- **정식 앱스토어 공개 출시** — 초대 배포로 시작, 안정화 후 별도 결정
- **다국어 앱 스토어 메타데이터** — 첫 배포는 한국어만
- **딥링크 (Universal Links / App Links)** — 도메인 확보 후 별도 도입

---

## 14. 결정 사항 체크리스트 (진행 전)

- [ ] 도메인 이름 확정 (예: `smartfarm-io.com`)
- [ ] 도메인 등록업체 선택 (Cloudflare Registrar 권장)
- [ ] 서브도메인 분리 vs 단일 도메인 결정 (초기는 단일 권장)
- [ ] 앱 표시 이름 확정 (예: "스마트팜")
- [ ] Apple Developer 계정 결제 시점
- [ ] Android 첫 배포 방식 (APK 직접 vs Play 내부 테스트)
- [ ] 프라이버시 정책 문안 준비 (스마트팜 IoT 데이터 수집 항목 명시)

---

## 15. PDCA 다음

→ 사용자가 도메인·이름 확정 후 `/pdca design mobile-hybrid-app` 로 진행
   (구체적인 Nginx 설정, Capacitor 설정 파일, 프론트 어댑터 코드 명세)
