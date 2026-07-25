# SmartFarm Mobile (Capacitor 하이브리드 앱)

기존 Vue 3 웹서비스(`../frontend`)를 iOS/Android 앱으로 래핑한 Capacitor 프로젝트.
웹 코드베이스를 그대로 번들 내장하고, 네이티브 기능(푸시)만 플러그인으로 추가한다.

## 빌드

```bash
# 1) 웹 번들 생성 (frontend 빌드 → www) + 네이티브 동기화
#    APP_API_BASE 로 백엔드 주소 지정 (기본: 프로덕션 IP)
APP_API_BASE="http://10.0.2.2:3100" bash scripts/build-web.sh   # Android 에뮬레이터(dev)
APP_API_BASE="http://localhost:3100" bash scripts/build-web.sh  # iOS 시뮬레이터(dev)

# 2) 네이티브 빌드/실행
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

`www/`, `node_modules/`, `ios/App/Pods/`, `android/**/build` 등은 gitignore(재생성). 클론 후 `npm install` + `build-web.sh` 필요.

---

## ⚠️ dev 전용 설정 — 프로덕션(스토어) 빌드 전 반드시 조정

현재 저장소 상태는 **로컬 백엔드(HTTP) 테스트용**이다. 프로덕션 배포 시 아래를 변경해야 한다.

| 위치 | 현재(dev) | 프로덕션 |
|---|---|---|
| `scripts/build-web.sh` `APP_API_BASE` | `10.0.2.2:3100` / `localhost:3100` | **HTTPS 프로덕션 도메인** (예: `https://api.도메인`) |
| `ios/App/App/Info.plist` `NSAppTransportSecurity` | localhost 평문 예외 | **제거** (도메인+공인 인증서면 불필요, 애플 심사 리스크) |
| `android/app/src/main/AndroidManifest.xml` `usesCleartextTraffic` | `true` | **제거/`false`** (Play 심사 플래그) |
| `capacitor.config.ts` `server.androidScheme` | `http` | HTTPS 도메인 기준 재검토 |

## 프로덕션 전환 체크리스트

1. **도메인 구매 + 공인 TLS 인증서**(Let's Encrypt 등) — iOS ATS/Android 보안정책 대전제.
2. **백엔드 변경 배포** — 앱 지원용 CORS 오리진(`capacitor://localhost`·`http://localhost`)과
   앱 전용 refresh token body 반환(`auth.controller`)이 프로덕션에 올라가 있어야 앱이 동작한다.
   (모두 하위호환 = 웹 사용자 무영향)
3. **위 dev 전용 설정 제거** + `APP_API_BASE`를 도메인으로.
4. **푸시(P3)**: Android=프로덕션 Firebase, iOS=Apple Developer($99/년) + APNs 키.
5. 앱 재빌드 → TestFlight / Play.

> 참고: `android/app/google-services.json` 은 Firebase **클라이언트 설정**(앱에 내장되는 값,
> 서버 비밀키 아님)이라 커밋되어 있다. 서버 푸시 발송용 **서비스 계정 키**는 별도이며
> 저장소에 두지 않는다(미수령 상태).
