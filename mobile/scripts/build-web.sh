#!/usr/bin/env bash
#
# 프론트 번들 연결 스크립트
# ---------------------------------------------------------------------------
# 기존 웹서비스(데스크톱·모바일 브라우저) 무영향 원칙:
#   - frontend/ 소스는 한 줄도 수정하지 않음
#   - frontend/dist 도 건드리지 않음 (출력은 mobile/www 로 분리)
#   - API/WS 주소는 빌드타임 env 주입만 (프론트 코드가 이미 VITE_* 를 읽음)
#
# 도메인 구매 후 교체: APP_API_BASE 값 한 줄만 바꾸면 됨.
# ---------------------------------------------------------------------------
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$(cd "$MOBILE_DIR/../frontend" && pwd)"
WWW_DIR="$MOBILE_DIR/www"

# 앱 번들이 호출할 백엔드 절대주소 (현재: 프로덕션 IP / 이후: 도메인)
API_BASE="${APP_API_BASE:-https://urifarm.com:8443}"

# 게이트웨이(Pi) 셋업 커맨드용 서버 주소/계정.
#   frontend 소스엔 dev 폴백(172.30.1.42 / ohjeongseok)이 남아 있으므로, 프로덕션 앱 번들엔
#   반드시 주입해서 dev 값이 새지 않게 한다. (SERVER_HOST 는 API_BASE 호스트에서 유도)
SERVER_HOST_INJ="${APP_SERVER_HOST:-$(printf '%s' "$API_BASE" | sed -E 's#^https?://##; s#[:/].*$##')}"
SERVER_USER_INJ="${APP_SERVER_USER:-jeongseok}"

echo "▶ 프론트 번들 빌드"
echo "   frontend : $FRONTEND_DIR (소스 무변경)"
echo "   출력     : $WWW_DIR"
echo "   API_BASE : $API_BASE"
echo "   SERVER   : $SERVER_USER_INJ@$SERVER_HOST_INJ (게이트웨이 셋업 커맨드용)"

cd "$FRONTEND_DIR"
# vue-tsc 타입체크는 건너뛰고 vite build 만 실행(번들 검증 목적). 산출물은 mobile/www 로.
VITE_API_URL="$API_BASE/api" \
VITE_WS_URL="$API_BASE" \
VITE_SERVER_HOST="$SERVER_HOST_INJ" \
VITE_SERVER_USER="$SERVER_USER_INJ" \
npx vite build --outDir "$WWW_DIR" --emptyOutDir

# --- PWA 서비스워커 제거 (Capacitor 네이티브 전용) ---
# 이유: capacitor:// 스킴에서 PWA SW 가 첫 로드시 빈 화면을 유발.
#       웹(브라우저)은 SW 유지, 앱 번들에서만 제거 → frontend 소스/웹 동작 무영향.
echo "▶ 네이티브 번들에서 PWA 서비스워커 제거"
rm -f "$WWW_DIR/sw.js" "$WWW_DIR/registerSW.js" "$WWW_DIR"/workbox-*.js "$WWW_DIR/manifest.webmanifest" 2>/dev/null || true
if [ -f "$WWW_DIR/index.html" ]; then
  # SW 등록 스크립트 + manifest 링크 제거
  sed -i '' -e 's#<script id="vite-plugin-pwa:register-sw"[^<]*</script>##g' \
            -e 's#<link rel="manifest"[^>]*>##g' "$WWW_DIR/index.html"
  # crossorigin 제거: WKWebView(capacitor:// 스킴)에서 crossorigin 모듈 스크립트가
  # 차단되어 흰 화면이 되는 문제 방지. 동일 오리진이므로 crossorigin 불필요.
  sed -i '' -e 's# crossorigin##g' "$WWW_DIR/index.html"
fi

echo "▶ Capacitor 동기화 (www → ios/android)"
cd "$MOBILE_DIR"
npx cap sync

echo "✅ 프론트 번들 연결 완료 (frontend 소스/ dist 무변경 유지)"
