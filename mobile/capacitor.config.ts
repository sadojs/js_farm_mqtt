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
    // dev(로컬 HTTP 백엔드) 테스트: Android 오리진을 http://localhost 로 맞춤
    //  → 백엔드 CORS(http://localhost)와 일치 + https→http 혼합콘텐츠 차단 회피.
    androidScheme: 'http',
  },
  ios: {
    contentInset: 'always',
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
