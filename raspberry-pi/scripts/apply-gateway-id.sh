#!/usr/bin/env bash
# ============================================================
# apply-gateway-id.sh — gateway-id 변경 + Z2M base_topic + 서비스 재시작
#
# 사용법: apply-gateway-id.sh <new-gateway-id>
#
# 영향:
#   - /etc/smartfarm/gateway-id
#   - /opt/zigbee2mqtt/data/configuration.yaml (mqtt.base_topic)
#   - config-agent.service / gpio-agent.service (Environment=GATEWAY_ID)
#   - 서비스 재시작: zigbee2mqtt, config-agent, gpio-agent
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-gateway-id.log
mkdir -p /var/log/smart-farm /etc/smartfarm

emit() { printf '%s\n' "$1"; exit 0; }

if [ "$#" -ne 1 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-gateway-id.sh <new-gateway-id>"}'
fi

NEW="$1"
# regex: 영숫자 시작, 영숫자/언더스코어/하이픈 중간, 영숫자 끝 (1~63자)
# 주의: bracket class 안에서 '-'는 마지막에 둬야 literal로 인식
if ! [[ "$NEW" =~ ^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$ ]]; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"invalid gateway-id: ${NEW}\"}"
fi

OLD=""
if [ -f /etc/smartfarm/gateway-id ]; then
  OLD="$(cat /etc/smartfarm/gateway-id 2>/dev/null || true)"
fi
echo "=== $(date -Iseconds) gateway-id ${OLD} -> ${NEW} ===" >&2

# 1. 마커 파일
echo -n "$NEW" > /etc/smartfarm/gateway-id

# 2. Z2M configuration.yaml — base_topic 치환
Z2M_CFG="/opt/zigbee2mqtt/data/configuration.yaml"
if [ -f "$Z2M_CFG" ]; then
  # base_topic: farm/<id>/z2m → farm/<NEW>/z2m
  sed -i.bak -E "s|^(\s*base_topic:\s*farm/)[^/]+(/z2m\s*)|\1${NEW}\2|" "$Z2M_CFG"
fi

# 3. systemd Environment 치환 (config-agent / gpio-agent)
for svc in /etc/systemd/system/config-agent.service /etc/systemd/system/gpio-agent.service; do
  if [ -f "$svc" ]; then
    sed -i.bak -E "s|^(Environment=GATEWAY_ID=).*|\1${NEW}|" "$svc"
  fi
done

# 4. /etc/smartfarm/*.env (EnvironmentFile 사용 시)
for envf in /etc/smartfarm/config-agent.env /etc/smartfarm/gpio-agent.env; do
  if [ -f "$envf" ]; then
    if grep -qE "^GATEWAY_ID=" "$envf"; then
      sed -i.bak -E "s|^GATEWAY_ID=.*|GATEWAY_ID=${NEW}|" "$envf"
    else
      echo "GATEWAY_ID=${NEW}" >> "$envf"
    fi
  fi
done

# 5. 서비스 재시작 (config-agent는 마지막에 — 응답 전송 후 재시작되어야 함)
# ⚠️ first-boot-init.service(oneshot) 안에서 호출될 수 있으므로 --no-block 필수.
#    동기 restart 시 systemd가 oneshot 완료를 기다리며 cyclic deadlock 발생.
systemctl daemon-reload >&2 || true
systemctl restart --no-block zigbee2mqtt >&2 || true
systemctl restart --no-block gpio-agent >&2 || true
# config-agent 재시작은 응답 전송 직후 별도 trigger (handler에서)

emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"gateway-id changed ${OLD}->${NEW}\",\"serviceRestarted\":true}"
