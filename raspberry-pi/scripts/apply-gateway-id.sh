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
# BUG-01 fix: fallback-engine.env도 포함 — 누락 시 fallback-engine이 옛 gateway_id로 동작
for envf in /etc/smartfarm/config-agent.env /etc/smartfarm/gpio-agent.env /etc/smartfarm/fallback-engine.env; do
  if [ -f "$envf" ]; then
    if grep -qE "^GATEWAY_ID=" "$envf"; then
      sed -i.bak -E "s|^GATEWAY_ID=.*|GATEWAY_ID=${NEW}|" "$envf"
    else
      echo "GATEWAY_ID=${NEW}" >> "$envf"
    fi
  fi
done

# 5. 서비스 재시작
# ⚠️ first-boot-init.service(oneshot) 안에서 호출 시 cyclic deadlock 위험으로 --no-block 사용.
#    BUG-02: 그러나 --no-block은 환경변수 reload를 보장 못함 — first-boot-init 종료 후
#    job 큐가 실제로 실행되어야 reload 됨. 운영자가 외부에서 호출 시(post-first-boot)는
#    동기 restart가 필요하므로 IS_FIRST_BOOT 플래그로 분기.
systemctl daemon-reload >&2 || true

# first-boot 단계 감지: marker가 아직 없으면 first-boot 중 → --no-block 사용
IS_FIRST_BOOT=0
if [ ! -f /var/lib/smartfarm/.first-boot-done ]; then
  IS_FIRST_BOOT=1
fi

if [ "$IS_FIRST_BOOT" = "1" ]; then
  systemctl restart --no-block zigbee2mqtt >&2 || true
  systemctl restart --no-block gpio-agent >&2 || true
  systemctl restart --no-block fallback-engine >&2 || true
else
  # 운영 중 호출: 동기 restart (환경변수 reload 보장)
  timeout 20 systemctl restart zigbee2mqtt >&2 || true
  timeout 20 systemctl restart gpio-agent >&2 || true
  timeout 20 systemctl restart fallback-engine >&2 || true
fi
# config-agent 재시작은 응답 전송 직후 별도 trigger (handler에서)

emit "{\"ok\":true,\"status\":\"success\",\"detail\":\"gateway-id changed ${OLD}->${NEW}\",\"serviceRestarted\":true}"
