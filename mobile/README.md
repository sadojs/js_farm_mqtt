# SmartFarm Mobile (Capacitor 하이브리드 앱)

기존 Vue 3 웹서비스(`../frontend`)를 iOS/Android 앱으로 래핑한 Capacitor 프로젝트.
웹 코드베이스를 그대로 번들 내장하고, 네이티브 기능(푸시)만 플러그인으로 추가한다.

> **저장소 기본 상태 = 프로덕션(`https://urifarm.com:8443`)**. androidScheme=https, cleartext/ATS 예외 없음.

## 프로덕션 빌드 (배포용)

```bash
cd mobile
npm install                     # (최초/클론 후)

# 1) 웹 번들 생성 + 네이티브 동기화 — 기본 주소가 프로덕션이므로 인자 불필요
bash scripts/build-web.sh
#    (필요 시 명시: APP_API_BASE="https://urifarm.com:8443" bash scripts/build-web.sh)

# 2-iOS) Xcode 로 아카이브 → TestFlight/App Store
npx cap open ios
#    Signing & Capabilities 에서 팀 선택, Product > Archive

# 2-Android) 릴리즈 APK/AAB
npx cap open android
#    또는: cd android && ./gradlew assembleRelease   (서명 설정 필요)
```

`www/`, `node_modules/`, `ios/App/Pods/`, `android/**/build` 등은 gitignore(재생성).

### 프로덕션 서버(백엔드) 전제조건 — 이게 없으면 앱이 동작 안 함
1. **`https://urifarm.com:8443` 에 공인 TLS 인증서**(Let's Encrypt 등). 자체서명이면 iOS/Android 앱이 연결 거부.
2. **백엔드에 앱 지원 코드 배포**(하위호환, 웹 무영향):
   - CORS origin 에 `capacitor://localhost`(iOS)·`https://localhost`(Android)·`http://localhost` 포함.
   - `auth.controller` 의 앱 전용 refresh token body 반환(`X-Client` 헤더). ← 없으면 앱 세션이 15분마다 끊김.
   - 프로덕션 백엔드의 `CORS_ORIGIN` 환경변수 = 프로덕션 웹 오리진(예: `https://urifarm.com:8443`).
3. **푸시(Android FCM)**: `android/app/google-services.json`(커밋됨, 클라이언트 설정)로 토큰 발급.
   서버 발송에는 Firebase **서비스 계정 키**(비밀, 미커밋) 필요 — 아직 미구현(P3).
4. **iOS 푸시**: Apple Developer($99/년) + APNs 키 필요(미구현, P3).

---

## dev(로컬 백엔드) 테스트로 전환하려면

프로덕션 저장소 상태를 로컬 HTTP 백엔드 테스트로 임시 전환하는 방법(커밋하지 말 것):

| 위치 | 프로덕션(현재) | dev 테스트 |
|---|---|---|
| `scripts/build-web.sh` 빌드 인자 | (기본) urifarm.com | `APP_API_BASE="http://localhost:3100"`(iOS 시뮬)·`http://10.0.2.2:3100`(Android 에뮬)·`http://<맥LANIP>:3100`(실기기) |
| `capacitor.config.ts` `androidScheme` | `https` | `http` |
| `android/.../AndroidManifest.xml` | (없음) | `<application android:usesCleartextTraffic="true" ...>` |
| `ios/App/App/Info.plist` | (없음) | `NSAppTransportSecurity` 에 대상 host 평문 예외 |

전환 후 `bash scripts/build-web.sh` 재실행. 로컬 백엔드는 `0.0.0.0` 바인딩 + 같은 네트워크 필요.

### iOS 실기기 팁
- Xcode Signing 에서 팀 선택(무료 계정 가능, 푸시는 불가). Bundle ID 는 계정별 고유하게.
- `dyld_shared_cache_extract` 에러 시: Edit Scheme > Run > Info > **Debug executable 해제**(디버거 없이 설치·실행).
- `Sandbox: deny ... Pods-*.sh` 에러 시: App 타겟 Build Settings 의 **User Script Sandboxing = No**.
