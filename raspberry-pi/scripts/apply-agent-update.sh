#!/usr/bin/env bash
# ============================================================
# apply-agent-update.sh — Pi agent 코드 업데이트 (rpi-agent-version-update)
#
# 사용법: apply-agent-update.sh <agent_name>
#   agent_name ∈ {config-agent, gpio-agent, fallback-engine}
#
# 동작:
#   1. backend /api/config-deploy/agent-archive/:agent 에서 tar.gz 다운로드
#   2. 현재 코드 .bak 백업
#   3. 새 코드로 교체 (rsync -a --delete)
#   4. npm install --omit=dev
#   5. systemctl restart + 5초 후 status 확인
#   6. 실패 시 .bak 복원 + restart
#
# Phase 1 한정 — config-agent self-update는 응답 전송 중 끊김 위험으로 권장 안 함.
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-agent-update.log
mkdir -p /var/log/smart-farm

emit() { printf '%s\n' "$1"; exit 0; }

if [ "$#" -ne 1 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-agent-update.sh <agent_name>"}'
fi

AGENT="$1"
case "$AGENT" in
  config-agent|gpio-agent|fallback-engine) ;;
  *) emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"invalid agent: ${AGENT}\"}" ;;
esac

DIR="/opt/smart-farm/${AGENT}"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

SERVER_IP="$(cat /etc/smartfarm/server-ip 2>/dev/null || echo 172.30.1.42)"
TOKEN="$(cat /etc/smartfarm/bootstrap.token 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  emit '{"ok":false,"status":"failed","detail":"bootstrap.token 없음"}'
fi

echo "=== $(date -Iseconds) ${AGENT} update ===" >&2

# 1. archive 다운로드
URL="http://${SERVER_IP}:3100/api/config-deploy/agent-archive/${AGENT}"
if ! curl -fsSL --max-time 60 \
     -H "X-Smartfarm-Bootstrap-Token: ${TOKEN}" \
     "$URL" -o "${TMP}/agent.tar.gz" 2>&1; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"archive 다운로드 실패: ${URL}\"}"
fi

# 2. tar 무결성
if ! tar -tzf "${TMP}/agent.tar.gz" >/dev/null 2>&1; then
  emit '{"ok":false,"status":"failed","detail":"tar.gz 손상"}'
fi

# 3. 백업
rm -rf "${DIR}.bak"
if [ -d "$DIR" ]; then
  cp -r "$DIR" "${DIR}.bak"
fi

rollback() {
  echo "[rollback] $(date -Iseconds) ${AGENT}" >&2
  if [ -d "${DIR}.bak" ]; then
    rm -rf "$DIR"
    mv "${DIR}.bak" "$DIR"
    systemctl restart "${AGENT}" >&2 || true
  fi
}

# 4. extract + 교체
mkdir -p "${TMP}/extract"
if ! tar -xzf "${TMP}/agent.tar.gz" -C "${TMP}/extract"; then
  rollback
  emit '{"ok":false,"status":"failed","detail":"tar extract 실패","rolledBack":true}'
fi
# extract 구조: ${TMP}/extract/${AGENT}/...
SRC="${TMP}/extract/${AGENT}"
if [ ! -d "$SRC" ]; then
  rollback
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"extract 디렉토리 구조 이상: ${SRC} 없음\",\"rolledBack\":true}"
fi

# package.json 보존(version 비교용)
OLD_VER=""
if [ -f "${DIR}/package.json" ]; then
  OLD_VER=$(grep '"version"' "${DIR}/package.json" | head -1 | sed -E 's/.*"version":[ ]*"([^"]+)".*/\1/')
fi
NEW_VER=$(grep '"version"' "${SRC}/package.json" 2>/dev/null | head -1 | sed -E 's/.*"version":[ ]*"([^"]+)".*/\1/')

# rsync로 atomic 교체 (--delete 옵션)
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude node_modules "${SRC}/" "${DIR}/"
else
  # rsync 없으면 mv 패턴
  rm -rf "${DIR}.new"
  mv "${SRC}" "${DIR}.new"
  rm -rf "$DIR"
  mv "${DIR}.new" "$DIR"
fi

# 5. npm install
if [ -f "${DIR}/package.json" ]; then
  (cd "$DIR" && npm install --omit=dev --no-audit --no-fund) >&2 || {
    rollback
    emit '{"ok":false,"status":"failed","detail":"npm install 실패","rolledBack":true}'
  }
fi

# 6. 재시작 + status 확인
systemctl restart "${AGENT}" >&2
sleep 5
STATE=$(systemctl is-active "${AGENT}")
if [ "$STATE" != "active" ]; then
  rollback
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"${AGENT} restart 후 inactive (state=${STATE})\",\"rolledBack\":true}"
fi

# 7. 정리 + 성공
rm -rf "${DIR}.bak"
emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"${AGENT} updated\",\"oldVersion\":\"${OLD_VER}\",\"newVersion\":\"${NEW_VER}\",\"serviceRestarted\":true}"
