#!/bin/bash
set -e

# ============================================================
# Smart Farm MQTT - Raspberry Pi Zigbee Gateway 설치 스크립트
# ============================================================
# 사용법: sudo bash setup.sh
#
# 이 스크립트는 라즈베리파이를 Zigbee Gateway로 설정합니다:
#   1. Mosquitto MQTT Broker 설치 및 설정
#   2. Zigbee2MQTT 설치 및 설정
#   3. systemd 서비스 등록 (부팅 시 자동 시작)
#   4. ZNDongle-E USB 디바이스 권한 설정
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
Z2M_VERSION="1.42.0"
Z2M_DIR="/opt/zigbee2mqtt"
MOSQUITTO_CONF="/etc/mosquitto/conf.d/smart-farm.conf"

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# root 권한 확인
if [ "$EUID" -ne 0 ]; then
  log_error "root 권한이 필요합니다. sudo bash setup.sh 로 실행해주세요."
  exit 1
fi

echo ""
echo "============================================"
echo "  Smart Farm MQTT - Zigbee Gateway Setup"
echo "============================================"
echo ""

# ---- Step 1: 시스템 업데이트 ----
log_info "Step 1/6: 시스템 업데이트..."
apt-get update -qq
apt-get upgrade -y -qq

# ---- Step 2: Mosquitto 설치 ----
log_info "Step 2/6: Mosquitto MQTT Broker 설치..."
apt-get install -y -qq mosquitto mosquitto-clients

# Mosquitto 설정 복사
cp "$SCRIPT_DIR/mosquitto/mosquitto.conf" "$MOSQUITTO_CONF"
log_info "  Mosquitto 설정 적용: $MOSQUITTO_CONF"

# Mosquitto 시작 및 자동 시작 등록
systemctl enable mosquitto
systemctl restart mosquitto
log_info "  Mosquitto 시작 완료 (포트 1883)"

# ---- Step 3: Node.js 설치 ----
log_info "Step 3/6: Node.js 20.x 설치..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  log_info "  Node.js $(node -v) 설치 완료"
else
  log_info "  Node.js $(node -v) 이미 설치됨"
fi

# ---- Step 4: Zigbee2MQTT 설치 ----
log_info "Step 4/6: Zigbee2MQTT 설치..."

# 의존성 설치
apt-get install -y -qq git make g++ gcc libsystemd-dev

# Zigbee2MQTT 다운로드
if [ ! -d "$Z2M_DIR" ]; then
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "$Z2M_DIR"
  cd "$Z2M_DIR"
  npm ci --production
  log_info "  Zigbee2MQTT 설치 완료: $Z2M_DIR"
else
  log_warn "  Zigbee2MQTT 이미 설치됨: $Z2M_DIR"
  cd "$Z2M_DIR"
  npm ci --production
fi

# Zigbee2MQTT 설정 복사
mkdir -p "$Z2M_DIR/data"
cp "$SCRIPT_DIR/zigbee2mqtt/configuration.yaml" "$Z2M_DIR/data/configuration.yaml"
log_info "  Zigbee2MQTT 설정 적용"

# ---- Step 5: USB 디바이스 권한 설정 ----
log_info "Step 5/6: ZNDongle-E USB 권한 설정..."

# udev 룰 생성 (Tuya ZNDongle-E = Silicon Labs CP2102N)
cat > /etc/udev/rules.d/99-zigbee.rules << 'UDEV'
# Tuya ZNDongle-E (Silicon Labs CP210x)
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyZigbee", MODE="0666"
# CC2652P based coordinators
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d4", SYMLINK+="ttyZigbee", MODE="0666"
UDEV

udevadm control --reload-rules
udevadm trigger
log_info "  USB 권한 설정 완료 (/dev/ttyZigbee symlink)"

# ---- Step 6: systemd 서비스 등록 ----
log_info "Step 6/6: systemd 서비스 등록..."

cp "$SCRIPT_DIR/systemd/zigbee2mqtt.service" /etc/systemd/system/zigbee2mqtt.service
systemctl daemon-reload
systemctl enable zigbee2mqtt
log_info "  zigbee2mqtt.service 등록 완료 (부팅 시 자동 시작)"

# ---- USB 디바이스 확인 ----
echo ""
echo "============================================"
echo "  설치 완료!"
echo "============================================"
echo ""

if [ -e /dev/ttyUSB0 ] || [ -e /dev/ttyZigbee ]; then
  log_info "USB Zigbee 디바이스 감지됨"
  ls -la /dev/ttyUSB* /dev/ttyZigbee 2>/dev/null || true
  echo ""
  log_info "Zigbee2MQTT 시작 중..."
  systemctl start zigbee2mqtt
  sleep 3
  if systemctl is-active --quiet zigbee2mqtt; then
    log_info "Zigbee2MQTT 정상 실행 중!"
  else
    log_warn "Zigbee2MQTT 시작 실패. 로그 확인: journalctl -u zigbee2mqtt -f"
  fi
else
  log_warn "USB Zigbee 디바이스가 감지되지 않았습니다."
  log_warn "ZNDongle-E를 USB에 연결한 후 아래 명령으로 시작하세요:"
  echo "  sudo systemctl start zigbee2mqtt"
fi

echo ""
echo "--------------------------------------------"
echo "  접속 정보"
echo "--------------------------------------------"
IP_ADDR=$(hostname -I | awk '{print $1}')
echo "  Zigbee2MQTT 웹UI:  http://${IP_ADDR}:8080"
echo "  MQTT Broker:        mqtt://${IP_ADDR}:1883"
echo ""
echo "  맥미니 .env 설정:"
echo "    MQTT_URL=mqtt://${IP_ADDR}:1883"
echo "    ZIGBEE2MQTT_URL=http://${IP_ADDR}:8080"
echo "--------------------------------------------"
echo ""
