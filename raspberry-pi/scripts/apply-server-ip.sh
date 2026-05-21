#!/usr/bin/env bash
# ============================================================
# apply-server-ip.sh — MQTT/Tunnel 서버 IP 동시 변경 (개발↔프로덕션 전환)
#
# 사용법: apply-server-ip.sh <new-server-ip-or-fqdn>
#
# 영향:
#   - /etc/smartfarm/server-ip
#   - /opt/zigbee2mqtt/data/configuration.yaml (mqtt.server)
#   - /etc/smartfarm/config-agent.env / gpio-agent.env (MQTT_SERVER)
#   - /etc/systemd/system/reverse-ssh-tunnel.service (Environment=SERVER_HOST)
#   - 서비스 재시작: zigbee2mqtt, config-agent, gpio-agent, reverse-ssh-tunnel
#
# 주의: config-agent 재시작은 응답 전송 직후 handler가 별도 처리
# ============================================================

set -u
exec 2>>/var/log/smart-farm/apply-server-ip.log
mkdir -p /var/log/smart-farm /etc/smartfarm

emit() { printf '%s\n' "$1"; exit 0; }

if [ "$#" -ne 1 ]; then
  emit '{"ok":false,"status":"failed","detail":"usage: apply-server-ip.sh <server-ip-or-fqdn>"}'
fi

NEW="$1"
# IPv4 또는 FQDN 검증
IPV4_RE='^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$'
FQDN_RE='^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
if ! [[ "$NEW" =~ $IPV4_RE || "$NEW" =~ $FQDN_RE ]]; then
  emit "{\"ok\":false,\"status\":\"failed\",\"detail\":\"invalid server-ip/fqdn: ${NEW}\"}"
fi

OLD=""
if [ -f /etc/smartfarm/server-ip ]; then
  OLD="$(cat /etc/smartfarm/server-ip 2>/dev/null || true)"
fi
echo "=== $(date -Iseconds) server-ip ${OLD} -> ${NEW} ===" >&2

# 1. 마커
echo -n "$NEW" > /etc/smartfarm/server-ip

# 2. Z2M configuration.yaml — mqtt.server 치환
Z2M_CFG="/opt/zigbee2mqtt/data/configuration.yaml"
if [ -f "$Z2M_CFG" ]; then
  sed -i.bak -E "s|^(\s*server:\s*mqtt://)[^:[:space:]]+(:?[0-9]*\s*)$|\1${NEW}\2|" "$Z2M_CFG"
fi

# 3. /etc/smartfarm/*.env (EnvironmentFile)
for envf in /etc/smartfarm/config-agent.env /etc/smartfarm/gpio-agent.env; do
  if [ -f "$envf" ]; then
    if grep -qE "^MQTT_SERVER=" "$envf"; then
      sed -i.bak -E "s|^MQTT_SERVER=.*|MQTT_SERVER=mqtt://${NEW}:1883|" "$envf"
    else
      echo "MQTT_SERVER=mqtt://${NEW}:1883" >> "$envf"
    fi
  fi
done

# 4. systemd Environment (인라인 systemd unit에서)
for svc in /etc/systemd/system/config-agent.service /etc/systemd/system/gpio-agent.service; do
  if [ -f "$svc" ]; then
    sed -i.bak -E "s|^(Environment=MQTT_SERVER=mqtt://)[^:[:space:]]+(:?[0-9]*)\s*$|\1${NEW}\2|" "$svc"
  fi
done

# 5. reverse-ssh-tunnel.service — SERVER_HOST 치환
TUN_SVC="/etc/systemd/system/reverse-ssh-tunnel.service"
if [ -f "$TUN_SVC" ]; then
  sed -i.bak -E "s|^(Environment=SERVER_HOST=).*|\1${NEW}|" "$TUN_SVC"
fi

# 6. daemon-reload + 재시작 (config-agent는 handler에서 별도)
systemctl daemon-reload >&2 || true
systemctl restart zigbee2mqtt >&2 || true
systemctl restart gpio-agent >&2 || true

# 7. 새 서버에 tunnel-key 재등록 (개발 → 프로덕션 전환 시나리오)
#    기존 tunnel_key를 새 서버 authorized_keys에 자동 등록 + 새 tunnel.env 수신
TOKEN_FILE=/etc/smartfarm/bootstrap.token
PUBKEY_FILE=/root/.ssh/tunnel_key.pub
if [ -s "$TOKEN_FILE" ] && [ -s "$PUBKEY_FILE" ]; then
  TOKEN="$(cat $TOKEN_FILE)"
  PUBKEY="$(cat $PUBKEY_FILE)"
  GW_ID="$(cat /etc/smartfarm/gateway-id 2>/dev/null || echo lgw-default)"
  MACHINE_ID="$(cat /etc/machine-id 2>/dev/null || true)"
  RPI_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  BODY=$(printf '{"gatewayId":"%s","publicKey":"%s","machineId":"%s","rpiIp":"%s"}' \
    "$GW_ID" "$PUBKEY" "$MACHINE_ID" "$RPI_IP")
  URL="http://${NEW}:3100/api/config-deploy/register-tunnel-key"
  echo "==> 새 서버 ${NEW}에 tunnel-key 재등록" >&2
  RESP=$(curl -fsS --max-time 30 \
    -H 'Content-Type: application/json' \
    -H "X-Smartfarm-Bootstrap-Token: $TOKEN" \
    -X POST -d "$BODY" "$URL" 2>&1 || echo "")
  echo "응답: $RESP" >&2
  # tunnel 정보 추출 → tunnel.env 재작성
  if echo "$RESP" | jq -e '.tunnel' >/dev/null 2>&1; then
    T_HOST=$(echo "$RESP" | jq -r '.tunnel.serverHost')
    T_USER=$(echo "$RESP" | jq -r '.tunnel.serverUser')
    T_PORT=$(echo "$RESP" | jq -r '.tunnel.serverPort')
    T_REMOTE=$(echo "$RESP" | jq -r '.tunnel.remotePort')
    cat > /etc/smartfarm/tunnel.env <<TENV
SERVER_HOST=${T_HOST}
SERVER_USER=${T_USER}
SERVER_PORT=${T_PORT}
REMOTE_PORT=${T_REMOTE}
TENV
    chmod 600 /etc/smartfarm/tunnel.env
    echo "tunnel.env 재작성: ${T_USER}@${T_HOST}:${T_PORT} → remote=${T_REMOTE}" >&2
    # ssh known_hosts 캐시 초기화 (새 서버는 host key 다름)
    rm -f /root/.ssh/known_hosts_tunnel
  else
    echo "WARN: 새 서버 응답에 tunnel 정보 없음 — 수동 등록 필요" >&2
  fi
fi

systemctl restart reverse-ssh-tunnel >&2 || true

emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"server-ip changed ${OLD}->${NEW}\",\"serviceRestarted\":true}"
