#!/usr/bin/env bash
# ============================================================
# apply-identity.sh — hostname + gateway-id 통합 변경
#                     (rpi-hostname-gateway-id-unify)
#
# 사용법: apply-identity.sh <name>
#
# 동작:
#   1. apply-hostname.sh <name> 실행 (hostname / /etc/hosts)
#   2. apply-gateway-id.sh <name> 실행 (gateway-id / Z2M base_topic / env / 서비스 재시작)
#   3. 단일 JSON 응답 emit
#
# 분리 호출 대비: 클릭/명령 1회로 둘 다 동기화. 양산 시 mismatch 방지.
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-identity.log
mkdir -p /var/log/smart-farm

emit() { printf '%s\n' "$1"; exit 0; }

if [ "$#" -ne 1 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-identity.sh <name>"}'
fi

NAME="$1"
# RFC 1123 hostname 정규식 (gateway-id 정규식보다 좁음 → 통합 시 더 좁은 hostname 기준)
if ! [[ "$NAME" =~ ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"invalid name: ${NAME}\"}"
fi

echo "=== $(date -Iseconds) identity → ${NAME} ===" >&2

# 1. hostname (재시작 트리거 없음, 단순 OS 호스트명 변경)
HOSTNAME_RES=$(bash /opt/smart-farm/scripts/apply-hostname.sh "$NAME" 2>&1)
HOSTNAME_RC=$?
echo "hostname result: $HOSTNAME_RES" >&2

# 2. gateway-id (재시작 포함 — config-agent / gpio-agent / fallback-engine / zigbee2mqtt)
GW_RES=$(bash /opt/smart-farm/scripts/apply-gateway-id.sh "$NAME" 2>&1)
GW_RC=$?
echo "gateway-id result: $GW_RES" >&2

# 3. 통합 응답
if [ "$HOSTNAME_RC" = "0" ] && [ "$GW_RC" = "0" ]; then
  emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"identity unified to ${NAME}\",\"name\":\"${NAME}\",\"serviceRestarted\":true}"
else
  emit "{\"ok\":false,\"status\":\"partial\",\"detail\":\"hostname=${HOSTNAME_RC} gateway-id=${GW_RC}\",\"name\":\"${NAME}\"}"
fi
