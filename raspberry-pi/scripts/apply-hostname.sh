#!/usr/bin/env bash
# ============================================================
# apply-hostname.sh — hostname 즉시 변경 (reboot 없이)
#
# 사용법: apply-hostname.sh <new-hostname>
#
# 동작 (BUG-2026-05-27 fix: 60초 reboot 제거):
#   1. hostnamectl set-hostname — 즉시 반영, reboot 불필요
#   2. /etc/hosts 127.0.1.1 갱신
#   3. avahi-daemon 재시작 — mDNS broadcast 갱신 (hostname.local 해석용)
#
# 주의: dhcpcd는 건드리지 않음. IP가 바뀌면 SSH 터널/MQTT 모두 재연결 필요 → 운영 중단 위험.
#       gpio-agent / zigbee2mqtt 등 gateway-id 의존 서비스는 apply-gateway-id.sh가 재시작.
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

# avahi-daemon이 새 hostname을 mDNS로 광고하도록 재시작 (있을 때만)
if systemctl is-enabled avahi-daemon >/dev/null 2>&1; then
  systemctl restart avahi-daemon >&2 || true
fi

emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"hostname applied (${OLD}->${NEW}), no reboot needed\",\"rebootScheduled\":false}"
