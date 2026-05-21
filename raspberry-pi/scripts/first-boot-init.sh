#!/usr/bin/env bash
# ============================================================
# first-boot-init.sh — 골든 이미지 첫 부팅 1회 실행
#
# 작업:
#   1. SSH host key 재생성 (모든 Pi 동일 키 방지)
#   2. /root/.ssh/tunnel_key ed25519 keypair 새로 생성
#   3. POST /api/config-deploy/register-tunnel-key 로 서버에 공개키 등록
#   4. /var/lib/smartfarm/.first-boot-done 마커 생성 (재실행 방지)
#
# 환경:
#   /etc/smartfarm/bootstrap.token — 사전 주입 토큰 (mode 600)
#   /etc/smartfarm/server-ip       — 서버 IP/FQDN
#   /etc/smartfarm/gateway-id      — 보통 "lgw-default"
# ============================================================

set -u
exec >>/var/log/smart-farm/first-boot-init.log 2>&1
mkdir -p /var/log/smart-farm /var/lib/smartfarm /etc/smartfarm

echo "=== $(date -Iseconds) first-boot-init starting ==="

if [ -f /var/lib/smartfarm/.first-boot-done ]; then
  echo "already done — skipping"
  exit 0
fi

# 1. SSH host key 재생성
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
dpkg-reconfigure openssh-server 2>&1 || ssh-keygen -A
systemctl restart ssh || systemctl restart sshd || true
echo "ssh host keys regenerated"

# 2. tunnel keypair
mkdir -p /root/.ssh
chmod 700 /root/.ssh
TUNNEL_KEY=/root/.ssh/tunnel_key
if [ -f "$TUNNEL_KEY" ]; then
  rm -f "$TUNNEL_KEY" "${TUNNEL_KEY}.pub"
fi
ssh-keygen -t ed25519 -f "$TUNNEL_KEY" -N "" -C "tunnel@$(hostname)"
chmod 600 "$TUNNEL_KEY"
PUBKEY="$(cat ${TUNNEL_KEY}.pub)"
echo "tunnel key generated"

# 3. 서버 등록
SERVER_IP="$(cat /etc/smartfarm/server-ip 2>/dev/null || true)"
TOKEN="$(cat /etc/smartfarm/bootstrap.token 2>/dev/null || true)"
GW_ID="$(cat /etc/smartfarm/gateway-id 2>/dev/null || echo lgw-default)"
MACHINE_ID="$(cat /etc/machine-id 2>/dev/null || true)"
RPI_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

if [ -z "$SERVER_IP" ] || [ -z "$TOKEN" ] || [ -z "$MACHINE_ID" ]; then
  echo "ERROR: required env file missing (server-ip / bootstrap.token / machine-id)"
  echo "공개키를 수동으로 서버 authorized_keys에 추가하세요:"
  echo "$PUBKEY"
  exit 1
fi

URL="http://${SERVER_IP}:3100/api/config-deploy/register-tunnel-key"
BODY=$(printf '{"gatewayId":"%s","publicKey":"%s","machineId":"%s","rpiIp":"%s"}' \
  "$GW_ID" "$PUBKEY" "$MACHINE_ID" "$RPI_IP")

# 5회 재시도 + 24시간 backoff (Q4 정책)
for i in 1 2 3 4 5; do
  CODE=$(curl -fsS --max-time 30 -o /tmp/register.out -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -H "X-Smartfarm-Bootstrap-Token: ${TOKEN}" \
    -X POST -d "$BODY" "$URL" || echo "000")
  echo "register attempt $i → HTTP $CODE"
  if [ "$CODE" = "200" ]; then
    # 응답 파싱
    NEW_GW_ID=$(jq -r '.gatewayId // empty' /tmp/register.out 2>/dev/null || true)
    T_HOST=$(jq -r '.tunnel.serverHost // empty' /tmp/register.out 2>/dev/null || true)
    T_USER=$(jq -r '.tunnel.serverUser // empty' /tmp/register.out 2>/dev/null || true)
    T_PORT=$(jq -r '.tunnel.serverPort // empty' /tmp/register.out 2>/dev/null || true)
    T_REMOTE=$(jq -r '.tunnel.remotePort // empty' /tmp/register.out 2>/dev/null || true)
    CURRENT_GW_ID="$(cat /etc/smartfarm/gateway-id 2>/dev/null || true)"

    # gateway_id 동기화 (자동 부여된 ID로 base_topic 변경)
    if [ -n "$NEW_GW_ID" ] && [ "$NEW_GW_ID" != "$CURRENT_GW_ID" ]; then
      echo "auto-rename: $CURRENT_GW_ID -> $NEW_GW_ID (백엔드가 자동 부여)"
      if [ -x /opt/smart-farm/scripts/apply-gateway-id.sh ]; then
        # 타임아웃 60초 — first-boot-init은 oneshot이므로 hang 시 후속 서비스(tunnel)도 막힘.
        timeout 60 bash /opt/smart-farm/scripts/apply-gateway-id.sh "$NEW_GW_ID" 2>&1 \
          || echo "apply-gateway-id.sh 실패/타임아웃 (수동 재시도 필요)"
      fi
    fi

    # tunnel.env 작성 (reverse-ssh-tunnel.service의 EnvironmentFile)
    if [ -n "$T_HOST" ] && [ -n "$T_USER" ] && [ -n "$T_PORT" ] && [ -n "$T_REMOTE" ]; then
      cat > /etc/smartfarm/tunnel.env <<TENV
SERVER_HOST=${T_HOST}
SERVER_USER=${T_USER}
SERVER_PORT=${T_PORT}
REMOTE_PORT=${T_REMOTE}
TENV
      chmod 600 /etc/smartfarm/tunnel.env
      # tunnel host key 캐시 초기화 (서버 변경 시 stale key 회피)
      rm -f /root/.ssh/known_hosts_tunnel
      echo "tunnel.env 작성: ${T_USER}@${T_HOST}:${T_PORT} → remote_port=${T_REMOTE}"
    else
      echo "WARN: 응답에 tunnel 정보 누락 — reverse-ssh-tunnel 비활성"
    fi

    touch /var/lib/smartfarm/.first-boot-done
    # ⚠️ deadlock 방지: reverse-ssh-tunnel은 After=first-boot-init.service 이므로
    # 동기 restart 시 cyclic wait. --no-block로 비동기 큐잉.
    systemctl restart --no-block reverse-ssh-tunnel || true
    echo "register OK"
    exit 0
  fi
  sleep $((i * 10))
done

echo "register failed after 5 attempts — will retry hourly via timer or operator intervention"
echo "공개키 (수동 등록용):"
echo "$PUBKEY"
exit 1
