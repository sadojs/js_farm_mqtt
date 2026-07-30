import type { CapacitorConfig } from '@capacitor/cli';

/**
 * SmartFarm 하이브리드 앱 셸 설정
 *
 * 방식: 번들 내장 (Plan v2, 2026-07-20 결정)
 *  - webDir 의 정적 파일을 앱에 내장 → 오프라인 초기 로드
 *  - API/WebSocket 은 원격 백엔드로 호출 (프론트 코드가 base URL 사용)
 *  - 기존 웹서비스(데스크톱·모바일 브라우저) 무영향: frontend/ 소스 변경 없음
 *
 * ⚠️ webDir 는 P1(셸 검증) 단계에서 placeholder(www/)를 사용.
 *    이후 실제 프론트 번들은 frontend 빌드 산출물을 mobile/www 로 복사(또는 심볼릭)하여 교체.
 *    → 이때도 frontend/ 소스는 변경하지 않고 "빌드 → 복사"만 수행.
 */
const config: CapacitorConfig = {
  appId: 'com.smartfarm.app',
  appName: 'SmartFarm',
  webDir: 'www',
  server: {
    // 프로덕션(HTTPS 도메인 https://urifarm.com:8443) 기준.
    // Android 오리진 = https://localhost (Capacitor 기본). 평문(cleartext) 불필요.
    //  → 백엔드 CORS 에 'https://localhost' 필요(추가돼 있음).
    // ⚠️ dev 로컬 HTTP 백엔드로 테스트할 땐 'http' 로 바꾸고 usesCleartextTraffic=true + ATS 예외 (README 참조).
    androidScheme: 'https',
  },
  ios: {
    // 'never': WebView 를 전체화면으로 두고 safe-area(다이나믹 아일랜드/홈인디케이터)를
    // CSS env(safe-area-inset-*) 로 처리한다. 'always' 는 env() 를 0 으로 만들어 헤더가
    // 상태바와 겹치는 문제가 있었다. (index.html 은 viewport-fit=cover)
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0f766e',
      showSpinner: false,
    },
  },
};

export default config;
