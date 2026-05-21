#!/usr/bin/env bash
# ============================================================
# apply-hostname.sh — hostname 즉시 변경 + 60초 후 reboot 예약
#
# 사용법: apply-hostname.sh <new-hostname>
#
# Design Q1 결정: hostnamectl 즉시 적용 + 60초 후 reboot 예약
# (운영자가 WS 응답 확인 시간 확보)
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-hostname.log
mkdir -p /var/log/smart-farm

emit() { printf '%s\n' "$1"; exit 0; }

if [ "$#" -ne 1 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-hostname.sh <hostname>"}'
fi

NEW="$1"
# RFC 1123 검증
if ! [[ "$NEW" =~ ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"invalid hostname: ${NEW}\"}"
fi

OLD="$(hostnamectl --static 2>/dev/null || hostname)"
echo "=== $(date -Iseconds) hostname ${OLD} -> ${NEW} ===" >&2

if ! hostnamectl set-hostname "$NEW" 2>&1 >&2; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"hostnamectl set-hostname failed\"}"
fi

# /etc/hosts 갱신 (127.0.1.1 entry)
if grep -qE "^127\.0\.1\.1\s" /etc/hosts; then
  sed -i.bak -E "s/^(127\.0\.1\.1\s+).*/\1${NEW}/" /etc/hosts
else
  echo "127.0.1.1 ${NEW}" >> /etc/hosts
fi

# 60초 후 reboot 예약 (응답 전송 시간 확보)
(sleep 60 && /sbin/reboot) >/dev/null 2>&1 &
disown $! 2>/dev/null || true

emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"hostname applied (${OLD}->${NEW}), reboot scheduled in 60s\",\"rebootScheduled\":true}"
