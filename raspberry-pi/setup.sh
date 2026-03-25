#!/bin/bash
set -e

# ============================================================
# Smart Farm MQTT - Raspberry Pi Zigbee Gateway 설치 스크립트
# 방식 A: 중앙 Broker (맥미니) + Zigbee2MQTT만 설치
# ============================================================
# 사용법: sudo bash setup.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
Z2M_DIR="/opt/zigbee2mqtt"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  log_error "root 권한이 필요합니다. sudo bash setup.sh 로 실행해주세요."
  exit 1
fi

echo ""
echo "============================================"
echo "  Smart Farm MQTT - Zigbee Gateway Setup"
echo "  방식 A: 중앙 Broker 연결"
echo "============================================"
echo ""

# ---- 게이트웨이 ID 및 서버 IP 입력 ----
read -p "게이트웨이 ID (예: farm01): " GATEWAY_ID
if [ -z "$GATEWAY_ID" ]; then
  log_error "게이트웨이 ID를 입력해야 합니다."
  exit 1
fi

read -p "맥미니(서버) IP 주소 (예: 172.30.1.60): " SERVER_IP
if [ -z "$SERVER_IP" ]; then
  log_error "서버 IP를 입력해야 합니다."
  exit 1
fi

echo ""
log_info "게이트웨이 ID: $GATEWAY_ID"
log_info "서버 IP: $SERVER_IP"
log_info "MQTT 토픽: farm/$GATEWAY_ID/z2m/#"
echo ""

# ---- Step 1: 시스템 업데이트 ----
log_info "Step 1/4: 시스템 업데이트..."
apt-get update -qq
apt-get upgrade -y -qq

# ---- Step 2: Node.js 설치 ----
log_info "Step 2/4: Node.js 20.x 설치..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  log_info "  Node.js $(node -v) 설치 완료"
else
  log_info "  Node.js $(node -v) 이미 설치됨"
fi

# ---- Step 3: Zigbee2MQTT 설치 ----
log_info "Step 3/4: Zigbee2MQTT 설치..."

apt-get install -y -qq git make g++ gcc libsystemd-dev

if [ ! -d "$Z2M_DIR" ]; then
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "$Z2M_DIR"
  cd "$Z2M_DIR"
  npm ci --production
  log_info "  Zigbee2MQTT 설치 완료"
else
  log_warn "  Zigbee2MQTT 이미 설치됨, 업데이트..."
  cd "$Z2M_DIR"
  npm ci --production
fi

# Zigbee2MQTT 설정 생성 (맥미니 Broker로 직접 연결)
mkdir -p "$Z2M_DIR/data"
cat > "$Z2M_DIR/data/configuration.yaml" << YAML
homeassistant: false

mqtt:
  base_topic: farm/${GATEWAY_ID}/z2m
  server: mqtt://${SERVER_IP}:1883

serial:
  port: /dev/ttyUSB0
  adapter: zstack

frontend:
  port: 8080
  host: 0.0.0.0

advanced:
  log_level: info
  log_output:
    - console
  network_key: GENERATE
  pan_id: GENERATE
  channel: 11
  last_seen: ISO_8601
  legacy_api: false
  legacy_availability_payload: false

availability:
  active:
    timeout: 10
  passive:
    timeout: 1500

ota:
  disable_automatic_update_check: true

devices: {}
groups: {}
YAML

log_info "  설정 적용: base_topic=farm/${GATEWAY_ID}/z2m, server=mqtt://${SERVER_IP}:1883"

# ---- Step 4: USB 권한 + systemd 서비스 ----
log_info "Step 4/4: USB 권한 및 서비스 등록..."

# udev 룰
cat > /etc/udev/rules.d/99-zigbee.rules << 'UDEV'
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyZigbee", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d4", SYMLINK+="ttyZigbee", MODE="0666"
UDEV
udevadm control --reload-rules
udevadm trigger

# systemd 서비스
cat > /etc/systemd/system/zigbee2mqtt.service << SERVICE
[Unit]
Description=Zigbee2MQTT - Smart Farm Gateway (${GATEWAY_ID})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/zigbee2mqtt
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable zigbee2mqtt
log_info "  zigbee2mqtt.service 등록 완료"

# ---- 완료 ----
echo ""
echo "============================================"
echo "  설치 완료!"
echo "============================================"
echo ""

if [ -e /dev/ttyUSB0 ] || [ -e /dev/ttyZigbee ]; then
  log_info "USB Zigbee 디바이스 감지됨"
  systemctl start zigbee2mqtt
  sleep 3
  if systemctl is-active --quiet zigbee2mqtt; then
    log_info "Zigbee2MQTT 정상 실행 중!"
  else
    log_warn "Zigbee2MQTT 시작 실패. 로그: journalctl -u zigbee2mqtt -f"
  fi
else
  log_warn "USB Zigbee 디바이스가 감지되지 않았습니다."
  log_warn "ZNDongle-E를 USB에 연결한 후: sudo systemctl start zigbee2mqtt"
fi

IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "--------------------------------------------"
echo "  접속 정보"
echo "--------------------------------------------"
echo "  게이트웨이 ID:     ${GATEWAY_ID}"
echo "  MQTT 토픽:         farm/${GATEWAY_ID}/z2m/#"
echo "  Zigbee2MQTT 웹UI:  http://${IP_ADDR}:8080"
echo "  연결 대상 Broker:   mqtt://${SERVER_IP}:1883"
echo ""
echo "  웹서비스에서 게이트웨이를 등록하세요:"
echo "    게이트웨이 ID: ${GATEWAY_ID}"
echo "    라즈베리파이 IP: ${IP_ADDR}"
echo "--------------------------------------------"
echo ""
