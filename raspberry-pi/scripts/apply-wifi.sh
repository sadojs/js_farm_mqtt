#!/usr/bin/env bash
# ============================================================
# apply-wifi.sh — Wi-Fi SSID/PW 원격 변경 (롤백 없음)
#
# 사용법: apply-wifi.sh <ssid> <password>
#
# 결과 JSON을 stdout에 1줄 출력 (config-agent가 캡쳐해서 MQTT publish):
#   { "ok": bool, "status": "applied_online|applied_no_internet|failed",
#     "detail": "...", "pingResult": { "tried": N, "ok": N } }
#
# 정책 (Design §3.1):
#   - 새 connection 추가 + 활성화 (nmcli)
#   - 60초 내 ping 8.8.8.8 3회 시도 → 인터넷 확인
#   - 실패해도 변경 유지 (본사 → 농장 SSID 전환 시 정상 시나리오)
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-wifi.log
echo "=== $(date -Iseconds) apply-wifi.sh args=($#) ===" >&2

LOG_DIR=/var/log/smart-farm
mkdir -p "$LOG_DIR"

emit() {
  # 단일 라인 JSON 출력
  printf '%s\n' "$1"
  exit 0
}

if [ "$#" -ne 2 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-wifi.sh <ssid> <password>"}'
fi

SSID="$1"
PSK="$2"

# nmcli 설치 확인
if ! command -v nmcli >/dev/null 2>&1; then
  emit '{"ok":false,"status":"failed","detail":"nmcli not installed"}'
fi

# 동일 connection 이미 있으면 삭제 (덮어쓰기)
if nmcli -t -f NAME connection show 2>/dev/null | grep -Fxq "$SSID"; then
  nmcli connection delete "$SSID" >&2 || true
fi

# 새 connection 추가 + 활성
if ! nmcli connection add type wifi ifname wlan0 \
    con-name "$SSID" ssid "$SSID" \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "$PSK" \
    connection.autoconnect yes >&2; then
  emit '{"ok":false,"status":"failed","detail":"nmcli connection add failed"}'
fi

if ! nmcli connection up "$SSID" >&2; then
  # 활성화 실패 — 연결은 등록되었으나 가시범위 밖일 수 있음 (농장 발송 시 정상)
  emit '{"ok":true,"status":"applied_no_internet","detail":"connection registered but not active in current location","pingResult":{"tried":0,"ok":0}}'
fi

# 60초 내 인터넷 확인
TRIED=0
OK=0
END=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  TRIED=$((TRIED + 1))
  if ping -c 1 -W 5 8.8.8.8 >/dev/null 2>&1; then
    OK=$((OK + 1))
  fi
  if [ "$OK" -ge 3 ]; then
    break
  fi
  sleep 2
done

if [ "$OK" -ge 1 ]; then
  emit "{\"ok\":true,\"status\":\"applied_online\",\"detail\":\"ping success\",\"pingResult\":{\"tried\":${TRIED},\"ok\":${OK}}}"
else
  emit "{\"ok\":true,\"status\":\"applied_no_internet\",\"detail\":\"wifi connected but no internet (normal for HQ→farm SSID transition)\",\"pingResult\":{\"tried\":${TRIED},\"ok\":${OK}}}"
fi
