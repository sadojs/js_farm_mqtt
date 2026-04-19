#!/bin/bash
set -e

# ============================================================
# Smart Farm MQTT - Raspberry Pi Zigbee Gateway 설치 스크립트
# 방식 A: 중앙 Broker (개발 서버) + Zigbee2MQTT만 설치
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

read -p "개발 서버 IP 주소 (예: 172.30.1.42): " SERVER_IP
if [ -z "$SERVER_IP" ]; then
  log_error "서버 IP를 입력해야 합니다."
  exit 1
fi

read -p "MQTT 사용자명 (기본: smartfarm): " MQTT_USER
MQTT_USER="${MQTT_USER:-smartfarm}"

read -s -p "MQTT 비밀번호: " MQTT_PASSWORD
echo ""
if [ -z "$MQTT_PASSWORD" ]; then
  log_error "MQTT 비밀번호를 입력해야 합니다."
  exit 1
fi

echo ""
log_info "게이트웨이 ID: $GATEWAY_ID"
log_info "서버 IP: $SERVER_IP"
log_info "MQTT 사용자: $MQTT_USER"
log_info "MQTT 토픽: farm/$GATEWAY_ID/z2m/#"
echo ""

# ---- Step 1: 시스템 업데이트 ----
log_info "Step 1/5: 시스템 업데이트..."
apt-get update -qq
apt-get upgrade -y -qq

# ---- Step 2: Node.js 설치 ----
log_info "Step 2/5: Node.js 20.x 설치..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  log_info "  Node.js $(node -v) 설치 완료"
else
  log_info "  Node.js $(node -v) 이미 설치됨"
fi

# ---- Step 3: Zigbee2MQTT 설치 ----
log_info "Step 3/5: Zigbee2MQTT 설치..."

apt-get install -y -qq git make g++ gcc libsystemd-dev

if [ ! -d "$Z2M_DIR" ]; then
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "$Z2M_DIR"
  log_info "  Zigbee2MQTT 클론 완료"
else
  log_warn "  Zigbee2MQTT 이미 설치됨, 건너뜀"
fi

cd "$Z2M_DIR"

# pnpm 우선 사용 (Zigbee2MQTT는 pnpm 기반)
if [ -f "pnpm-lock.yaml" ]; then
  npm install -g pnpm --quiet 2>/dev/null || true
  pnpm install        # devDependencies 포함 (tsc 빌드에 필요)
  pnpm run build      # TypeScript → dist 빌드
else
  npm install --omit=dev --quiet
fi
log_info "  Zigbee2MQTT 의존성 및 빌드 완료"

# Zigbee2MQTT 설정 파일 생성
mkdir -p "$Z2M_DIR/data"
cat > "$Z2M_DIR/data/configuration.yaml" << YAML
homeassistant: false

mqtt:
  base_topic: farm/${GATEWAY_ID}/z2m
  server: mqtt://${SERVER_IP}:1883
  user: ${MQTT_USER}
  password: ${MQTT_PASSWORD}

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
log_info "Step 4/5: USB 권한 및 서비스 등록..."

# udev 룰 (Zigbee 동글 자동 심링크)
cat > /etc/udev/rules.d/99-zigbee.rules << 'UDEV'
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyZigbee", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d4", SYMLINK+="ttyZigbee", MODE="0666"
UDEV
udevadm control --reload-rules
udevadm trigger

# Zigbee2MQTT systemd 서비스
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

# ---- Step 5: Config Agent 설치 ----
log_info "Step 5/5: Config Agent 설치..."

CONFIG_AGENT_DIR="/opt/smart-farm/config-agent"
mkdir -p "$CONFIG_AGENT_DIR"

# config-agent 파일 복사
cp -r "$SCRIPT_DIR/config-agent/"* "$CONFIG_AGENT_DIR/"

# 의존성 설치
cd "$CONFIG_AGENT_DIR"
npm install --omit=dev --quiet
log_info "  Config Agent 설치 완료"

# config-agent systemd 서비스
cat > /etc/systemd/system/config-agent.service << SERVICE
[Unit]
Description=Smart Farm Config Agent (${GATEWAY_ID})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${CONFIG_AGENT_DIR}
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=GATEWAY_ID=${GATEWAY_ID}
Environment=MQTT_SERVER=mqtt://${SERVER_IP}:1883
Environment=MQTT_USERNAME=${MQTT_USER}
Environment=MQTT_PASSWORD=${MQTT_PASSWORD}
Environment=Z2M_CONFIG_PATH=/opt/zigbee2mqtt/data/configuration.yaml

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable config-agent
systemctl start config-agent
log_info "  config-agent.service 등록 및 시작 완료"

# ---- Zigbee 동글 확인 후 Z2M 시작 ----
echo ""
if [ -e /dev/ttyUSB0 ] || [ -e /dev/ttyZigbee ]; then
  log_info "USB Zigbee 동글 감지됨 - Zigbee2MQTT 시작"
  systemctl start zigbee2mqtt
  sleep 3
  if systemctl is-active --quiet zigbee2mqtt; then
    log_info "Zigbee2MQTT 정상 실행 중!"
  else
    log_warn "Zigbee2MQTT 시작 실패. 로그: journalctl -u zigbee2mqtt -f"
  fi
else
  log_warn "USB Zigbee 동글이 감지되지 않았습니다."
  log_warn "동글 연결 후 실행: sudo systemctl start zigbee2mqtt"
fi

# ---- 완료 ----
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "============================================"
echo "  설치 완료!"
echo "============================================"
echo "  게이트웨이 ID:      ${GATEWAY_ID}"
echo "  MQTT 토픽:          farm/${GATEWAY_ID}/z2m/#"
echo "  Zigbee2MQTT 웹UI:   http://${IP_ADDR}:8080"
echo "  연결 Broker:        mqtt://${SERVER_IP}:1883"
echo ""
echo "  서비스 상태 확인:"
echo "    sudo systemctl status config-agent"
echo "    sudo systemctl status zigbee2mqtt"
echo ""
echo "  서버에서 게이트웨이를 등록하세요:"
echo "    게이트웨이 ID: ${GATEWAY_ID}"
echo "    라즈베리파이 IP: ${IP_ADDR}"
echo "============================================"
echo ""
