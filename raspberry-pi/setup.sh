#!/usr/bin/env bash
# ============================================================
# Smart Farm MQTT — Raspberry Pi Production Setup
# ============================================================
# 라즈베리파이에 다음 컴포넌트를 설치한다:
#   1. Zigbee2MQTT       (Zigbee 동글 → MQTT 브릿지)
#   2. Config Agent      (원격 설정 배포 수신)
#   3. GPIO Agent        (릴레이/온보드 GPIO 제어)
#   4. (선택) Reverse SSH Tunnel  (서버에서 Pi 원격 접속)
#
# 사용법:
#   sudo bash setup.sh                          # 인터랙티브 모드
#   sudo GATEWAY_ID=lgw-farm01 SERVER_IP=… \
#        MQTT_USER=… MQTT_PASSWORD=… \
#        bash setup.sh --noninteractive         # 환경변수 모드
#
# 옵션:
#   --noninteractive   환경변수 기반 자동 실행 (대화형 프롬프트 생략)
#   --with-tunnel      Reverse SSH 터널까지 함께 설치
#   --skip-update      apt update/upgrade 생략 (빠른 재실행용)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
Z2M_DIR="/opt/zigbee2mqtt"
SMART_FARM_DIR="/opt/smart-farm"
LOG_FILE="/var/log/smart-farm-setup.log"

# ── 옵션 파싱 ────────────────────────────────────────────
NONINTERACTIVE=false
WITH_TUNNEL=false
SKIP_UPDATE=false
for arg in "$@"; do
  case "$arg" in
    --noninteractive) NONINTERACTIVE=true ;;
    --with-tunnel)    WITH_TUNNEL=true ;;
    --skip-update)    SKIP_UPDATE=true ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//; 1,/^$/d' | head -30
      exit 0
      ;;
  esac
done

# ── 컬러 + 로깅 ──────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE" >&2; }
log_step()  { echo -e "\n${BLUE}━━━ $1 ━━━${NC}" | tee -a "$LOG_FILE"; }

# ── 사전 점검 ────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  log_error "root 권한이 필요합니다. 'sudo bash setup.sh' 로 실행해주세요."
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"
echo "=== Setup started at $(date -Iseconds) ===" >> "$LOG_FILE"

# Pi 모델 + OS 확인
PI_MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "unknown")
OS_INFO=$(grep -E "^(NAME|VERSION_ID)" /etc/os-release 2>/dev/null | paste -sd ' / ' - || echo "unknown")
log_info "Pi 모델: ${PI_MODEL}"
log_info "OS: ${OS_INFO}"

# 디스크 공간 확인 (≥ 2GB free 권장)
FREE_MB=$(df / | awk 'NR==2 {print int($4/1024)}')
log_info "남은 디스크 공간: ${FREE_MB} MB"
if [ "$FREE_MB" -lt 2048 ]; then
  log_warn "권장: 최소 2GB 여유 공간. 현재 ${FREE_MB}MB. 설치 도중 부족할 수 있습니다."
  if [ "$NONINTERACTIVE" = false ]; then
    read -p "계속할까요? [y/N]: " yn
    [[ "${yn:-N}" =~ ^[Yy]$ ]] || exit 1
  fi
fi

# 인터넷 연결 확인
if ! curl -fsS --max-time 8 https://deb.nodesource.com/ > /dev/null 2>&1; then
  log_error "인터넷 연결이 불안정합니다. 네트워크를 확인하세요."
  exit 1
fi

echo ""
echo "============================================"
echo "  Smart Farm MQTT — Raspberry Pi Setup"
echo "  방식: 중앙 Broker 연결 (Zigbee + GPIO)"
echo "============================================"
echo ""

# ── 입력 (인터랙티브 모드) ──────────────────────────────
if [ "$NONINTERACTIVE" = false ]; then
  read -p "게이트웨이 ID (예: lgw-farm01): " GATEWAY_ID
  [ -z "${GATEWAY_ID:-}" ] && { log_error "게이트웨이 ID는 필수입니다."; exit 1; }

  read -p "중앙 서버 IP/호스트명 (예: 172.30.1.42 또는 farm.example.com): " SERVER_IP
  [ -z "${SERVER_IP:-}" ] && { log_error "서버 IP/호스트명은 필수입니다."; exit 1; }

  read -p "MQTT 사용자명 [smartfarm]: " MQTT_USER
  MQTT_USER="${MQTT_USER:-smartfarm}"

  read -s -p "MQTT 비밀번호: " MQTT_PASSWORD
  echo ""
  [ -z "${MQTT_PASSWORD:-}" ] && { log_error "MQTT 비밀번호는 필수입니다."; exit 1; }

  if [ "$WITH_TUNNEL" = false ]; then
    read -p "Reverse SSH 터널을 함께 설치할까요? [y/N]: " yn
    [[ "${yn:-N}" =~ ^[Yy]$ ]] && WITH_TUNNEL=true
  fi

  if [ "$WITH_TUNNEL" = true ]; then
    read -p "백엔드 URL (예: http://172.30.1.42:3100): " BACKEND_URL
    [ -z "${BACKEND_URL:-}" ] && { log_error "터널 설치에는 BACKEND_URL이 필요합니다."; exit 1; }
    read -p "서버 SSH 계정 [pi]: " SERVER_USER
    SERVER_USER="${SERVER_USER:-pi}"
    read -p "서버 SSH 포트 [22]: " SERVER_PORT
    SERVER_PORT="${SERVER_PORT:-22}"
  fi
else
  # 비대화형: 환경변수 검증
  : "${GATEWAY_ID:?GATEWAY_ID 환경변수가 필요합니다}"
  : "${SERVER_IP:?SERVER_IP 환경변수가 필요합니다}"
  : "${MQTT_USER:=smartfarm}"
  : "${MQTT_PASSWORD:?MQTT_PASSWORD 환경변수가 필요합니다}"
  if [ "$WITH_TUNNEL" = true ]; then
    : "${BACKEND_URL:?터널 옵션에는 BACKEND_URL 환경변수가 필요합니다}"
    : "${SERVER_USER:=pi}"
    : "${SERVER_PORT:=22}"
  fi
fi

echo ""
log_info "게이트웨이 ID:    ${GATEWAY_ID}"
log_info "서버:             ${SERVER_IP}"
log_info "MQTT 사용자:      ${MQTT_USER}"
log_info "MQTT 토픽:        farm/${GATEWAY_ID}/z2m/#"
log_info "Reverse Tunnel:   $([ "$WITH_TUNNEL" = true ] && echo "예 (${BACKEND_URL:-})" || echo "아니오")"
echo ""

# ── Step 1/8: 시스템 업데이트 ──────────────────────────
if [ "$SKIP_UPDATE" = false ]; then
  log_step "Step 1/8: 시스템 업데이트"
  apt-get update -qq
  apt-get upgrade -y -qq
  log_info "패키지 업데이트 완료"
else
  log_step "Step 1/8: 시스템 업데이트 (--skip-update — 생략)"
fi

# ── Step 2/8: 기본 패키지 + 시간 동기화 ────────────────
log_step "Step 2/8: 기본 패키지 + 시간 동기화"
apt-get install -y -qq curl jq git make g++ gcc libsystemd-dev chrony unattended-upgrades

# 시간 동기화 (자동제어 룰 타이밍에 영향 — 중요)
systemctl enable --now chrony >/dev/null 2>&1 || true
log_info "chrony NTP 활성화"

# unattended-upgrades 보안 패치 자동화
echo 'APT::Periodic::Update-Package-Lists "1";' > /etc/apt/apt.conf.d/20auto-upgrades
echo 'APT::Periodic::Unattended-Upgrade "1";' >> /etc/apt/apt.conf.d/20auto-upgrades
log_info "보안 업데이트 자동화 활성화"

# ── Step 3/8: Node.js 20 ───────────────────────────────
log_step "Step 3/8: Node.js 20.x 설치"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
log_info "Node.js $(node -v)"
log_info "npm $(npm -v)"

# ── Step 4/8: Zigbee2MQTT ──────────────────────────────
log_step "Step 4/8: Zigbee2MQTT 설치"

if [ ! -d "$Z2M_DIR" ]; then
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "$Z2M_DIR"
  log_info "Zigbee2MQTT 클론 완료"
else
  log_warn "Zigbee2MQTT 이미 설치됨 — 의존성만 갱신"
fi

cd "$Z2M_DIR"
if [ -f "pnpm-lock.yaml" ]; then
  npm install -g pnpm --silent 2>/dev/null || true
  pnpm install --silent
  pnpm run build
else
  npm install --omit=dev --silent
fi
log_info "Zigbee2MQTT 빌드 완료"

# Z2M 설정
mkdir -p "$Z2M_DIR/data"
cat > "$Z2M_DIR/data/configuration.yaml" <<YAML
homeassistant: false

mqtt:
  base_topic: farm/${GATEWAY_ID}/z2m
  server: mqtt://${SERVER_IP}:1883
  user: ${MQTT_USER}
  password: ${MQTT_PASSWORD}
  keepalive: 60

serial:
  port: /dev/ttyZigbee
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
log_info "Z2M 설정 적용: base_topic=farm/${GATEWAY_ID}/z2m → mqtt://${SERVER_IP}:1883"

# ── Step 5/8: USB 권한 (udev) ──────────────────────────
log_step "Step 5/8: USB Zigbee 동글 udev 규칙"
cat > /etc/udev/rules.d/99-zigbee.rules <<'UDEV'
# CP2102 (Sonoff ZBDongle-P, Sonoff ZBDongle-E)
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyZigbee", MODE="0666"
# CH9102F (Sonoff Plus, Slaesh)
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d4", SYMLINK+="ttyZigbee", MODE="0666"
# FTDI (CC2531 기반)
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", SYMLINK+="ttyZigbee", MODE="0666"
UDEV
udevadm control --reload-rules
udevadm trigger
log_info "udev 규칙 적용 (Sonoff/CC2531 자동 인식)"

# ── Step 6/8: Z2M systemd 서비스 ───────────────────────
log_step "Step 6/8: Zigbee2MQTT systemd 서비스"
cat > /etc/systemd/system/zigbee2mqtt.service <<SERVICE
[Unit]
Description=Zigbee2MQTT — Smart Farm Gateway (${GATEWAY_ID})
After=network-online.target chrony.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${Z2M_DIR}
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
log_info "zigbee2mqtt.service 등록"

# ── Step 7/8: Config Agent + GPIO Agent ────────────────
log_step "Step 7/8: Config Agent + GPIO Agent 설치"

# Config Agent
CONFIG_AGENT_DIR="${SMART_FARM_DIR}/config-agent"
mkdir -p "$CONFIG_AGENT_DIR"
cp -r "$SCRIPT_DIR/config-agent/"* "$CONFIG_AGENT_DIR/"
( cd "$CONFIG_AGENT_DIR" && npm install --omit=dev --silent )
log_info "Config Agent 설치 완료"

cat > /etc/systemd/system/config-agent.service <<SERVICE
[Unit]
Description=Smart Farm Config Agent (${GATEWAY_ID})
After=network-online.target chrony.service zigbee2mqtt.service
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
Environment=Z2M_CONFIG_PATH=${Z2M_DIR}/data/configuration.yaml

[Install]
WantedBy=multi-user.target
SERVICE

# GPIO Agent
GPIO_AGENT_DIR="${SMART_FARM_DIR}/gpio-agent"
mkdir -p "$GPIO_AGENT_DIR"
cp -r "$SCRIPT_DIR/gpio-agent/"* "$GPIO_AGENT_DIR/"
( cd "$GPIO_AGENT_DIR" && npm install --omit=dev --silent )
log_info "GPIO Agent 설치 완료"

mkdir -p /etc/smartfarm
cat > /etc/smartfarm/gpio-agent.env <<ENV
GATEWAY_ID=${GATEWAY_ID}
MQTT_SERVER=mqtt://${SERVER_IP}:1883
MQTT_USERNAME=${MQTT_USER}
MQTT_PASSWORD=${MQTT_PASSWORD}
ENV
chmod 600 /etc/smartfarm/gpio-agent.env

cat > /etc/systemd/system/gpio-agent.service <<SERVICE
[Unit]
Description=Smart Farm GPIO Relay Agent (${GATEWAY_ID})
After=network-online.target chrony.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${GPIO_AGENT_DIR}
EnvironmentFile=/etc/smartfarm/gpio-agent.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gpio-agent

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable config-agent gpio-agent
systemctl restart config-agent gpio-agent
log_info "config-agent + gpio-agent 시작 완료"

# ── Step 8/8: Reverse SSH 터널 (선택) ──────────────────
if [ "$WITH_TUNNEL" = true ]; then
  log_step "Step 8/8: Reverse SSH 터널 설치"
  if [ ! -f "$SCRIPT_DIR/tunnel-setup.sh" ]; then
    log_error "tunnel-setup.sh 파일을 찾을 수 없습니다: $SCRIPT_DIR"
    exit 1
  fi
  GATEWAY_ID="$GATEWAY_ID" \
    BACKEND_URL="$BACKEND_URL" \
    SERVER_HOST="$SERVER_IP" \
    SERVER_USER="$SERVER_USER" \
    SERVER_PORT="$SERVER_PORT" \
    bash "$SCRIPT_DIR/tunnel-setup.sh"
else
  log_step "Step 8/8: Reverse SSH 터널 (생략 — --with-tunnel 옵션으로 추가 설치 가능)"
fi

# ── Zigbee 동글 감지 후 Z2M 시작 ───────────────────────
echo ""
if [ -e /dev/ttyZigbee ] || [ -e /dev/ttyUSB0 ]; then
  log_info "USB Zigbee 동글 감지 — Zigbee2MQTT 시작"
  systemctl start zigbee2mqtt
  sleep 3
  if systemctl is-active --quiet zigbee2mqtt; then
    log_info "✓ Zigbee2MQTT 정상 실행 중"
  else
    log_warn "Zigbee2MQTT 시작 실패. 'journalctl -u zigbee2mqtt -n 50'으로 확인"
  fi
else
  log_warn "USB Zigbee 동글이 감지되지 않았습니다."
  log_warn "동글 연결 후 'sudo systemctl start zigbee2mqtt' 실행"
fi

# ── 최종 상태 요약 ────────────────────────────────────
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ 설치 완료!"
echo "═══════════════════════════════════════════════════"
echo "  게이트웨이 ID:    ${GATEWAY_ID}"
echo "  MQTT 토픽:        farm/${GATEWAY_ID}/z2m/#"
echo "  Zigbee2MQTT 웹UI: http://${IP_ADDR}:8080"
echo "  연결 Broker:      mqtt://${SERVER_IP}:1883"
echo "  로그 파일:        ${LOG_FILE}"
echo ""
echo "  서비스 상태:"
for svc in zigbee2mqtt config-agent gpio-agent; do
  status=$(systemctl is-active "$svc" 2>/dev/null || echo "inactive")
  printf "    %-18s %s\n" "$svc" "$status"
done
if [ "$WITH_TUNNEL" = true ]; then
  status=$(systemctl is-active reverse-ssh-tunnel 2>/dev/null || echo "inactive")
  printf "    %-18s %s\n" "reverse-ssh-tunnel" "$status"
fi
echo ""
echo "  중앙 서버에 게이트웨이를 등록하세요:"
echo "    - 게이트웨이 ID: ${GATEWAY_ID}"
echo "    - 라즈베리파이 IP: ${IP_ADDR}"
echo "═══════════════════════════════════════════════════"
echo ""
echo "=== Setup completed at $(date -Iseconds) ===" >> "$LOG_FILE"
