#!/usr/bin/env bash
# ============================================================
# apply-credentials.sh — 서버 MQTT 비밀번호 / BOOTSTRAP_TOKEN 이 바뀌었을 때 게이트웨이(Pi)에 반영
#
# 배경: 2026-11-25 운영 서버 보안사고 후 서버의 MQTT 비밀번호와 BOOTSTRAP_TOKEN 을 교체했다.
#       그때 꺼져 있던 게이트웨이(yeondong-house 등)는 다시 켜면 MQTT 인증에 실패하므로 이 스크립트로 맞춘다.
#       (리버스 SSH 터널은 키 인증이라 영향 없음 → 서버에서 터널로 접속해 실행 가능)
#
# 사용법 (Pi 에서, root):
#   sudo MQTT_PASSWORD='새비번' BOOTSTRAP_TOKEN='새토큰' bash apply-credentials.sh
#   - 둘 중 하나만 줘도 됨. 값은 운영자 맥의 ~/secrets/prod-credentials-20261125.txt 에 있음.
#   - 서버에서 터널로:  ssh -p <터널포트> lgw-default@localhost  → 위 명령 실행
#
# 영향:
#   - /opt/zigbee2mqtt/data/configuration.yaml (mqtt.password)
#   - /etc/smartfarm/{config-agent,gpio-agent,fallback-engine}.env (MQTT_PASSWORD)
#   - /etc/systemd/system/{config-agent,gpio-agent,zigbee2mqtt}.service (Environment=MQTT_PASSWORD)
#   - /etc/mosquitto/conf.d/bridge-cloud.conf (remote_password, 로컬 브로커 사용 Pi)
#   - /etc/smartfarm/bootstrap.token
#   - 서비스 재시작: zigbee2mqtt, config-agent, gpio-agent, fallback-engine, mosquitto
# 각 파일은 .bak-<시각> 으로 백업한다.
# ============================================================
set -u
[ "$(id -u)" -eq 0 ] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
MQTT_PASSWORD="${MQTT_PASSWORD:-}"
BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-}"
[ -n "$MQTT_PASSWORD$BOOTSTRAP_TOKEN" ] || { echo "MQTT_PASSWORD 또는 BOOTSTRAP_TOKEN 을 지정하세요"; exit 1; }
TS=$(date +%Y%m%d%H%M%S)
changed=0

bk() { cp -p "$1" "$1.bak-$TS"; }
# sed 치환용 이스케이프(| & \)
esc() { printf '%s' "$1" | sed -e 's/[|&\\]/\\&/g'; }

if [ -n "$MQTT_PASSWORD" ]; then
  P=$(esc "$MQTT_PASSWORD")
  Z2M=/opt/zigbee2mqtt/data/configuration.yaml
  if [ -f "$Z2M" ]; then
    bk "$Z2M"; sed -i -E "s|^([[:space:]]+password:[[:space:]]*).*$|\1${P}|" "$Z2M"; echo "z2m configuration.yaml 갱신"; changed=1
  fi
  for f in /etc/smartfarm/config-agent.env /etc/smartfarm/gpio-agent.env /etc/smartfarm/fallback-engine.env; do
    [ -f "$f" ] || continue
    bk "$f"; sed -i -E "s|^MQTT_PASSWORD=.*$|MQTT_PASSWORD=${P}|" "$f"; chmod 600 "$f"; echo "$f 갱신"; changed=1
  done
  for f in /etc/systemd/system/config-agent.service /etc/systemd/system/gpio-agent.service /etc/systemd/system/zigbee2mqtt.service; do
    [ -f "$f" ] && grep -q "^Environment=MQTT_PASSWORD=" "$f" || continue
    bk "$f"; sed -i -E "s|^Environment=MQTT_PASSWORD=.*$|Environment=MQTT_PASSWORD=${P}|" "$f"; echo "$f 갱신"; changed=1
  done
  BR=/etc/mosquitto/conf.d/bridge-cloud.conf
  if [ -f "$BR" ] && grep -q "^remote_password" "$BR"; then
    bk "$BR"; sed -i -E "s|^remote_password .*$|remote_password ${P}|" "$BR"; echo "bridge-cloud.conf 갱신"; changed=1
  fi
fi

if [ -n "$BOOTSTRAP_TOKEN" ]; then
  mkdir -p /etc/smartfarm
  [ -f /etc/smartfarm/bootstrap.token ] && bk /etc/smartfarm/bootstrap.token
  printf '%s' "$BOOTSTRAP_TOKEN" > /etc/smartfarm/bootstrap.token; chmod 600 /etc/smartfarm/bootstrap.token
  echo "bootstrap.token 갱신"; changed=1
fi

if [ "$changed" -eq 1 ]; then
  systemctl daemon-reload
  for s in mosquitto zigbee2mqtt gpio-agent fallback-engine config-agent; do
    systemctl list-unit-files "$s.service" >/dev/null 2>&1 && systemctl restart "$s" 2>/dev/null && echo "재시작: $s"
  done
fi
echo "완료. 서버 웹 > 게이트웨이 화면에서 온라인 여부를 확인하세요."
