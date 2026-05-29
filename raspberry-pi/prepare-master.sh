#!/usr/bin/env bash
# ============================================================
# prepare-master.sh — 마스터 Pi를 골든 이미지 베이스로 만드는 1회용 스크립트
#
# 이 스크립트는 마스터 Pi(lgw-HK 등)에서 1번만 실행합니다.
# 끝나면 Pi가 자동 종료되며 SD 카드를 빼서 build-golden-image.sh로 추출하면 됩니다.
#
# 사용법:
#   sudo bash prepare-master.sh                          # 인터랙티브
#   sudo BOOTSTRAP_TOKEN=... HQ_WIFI_SSID=... HQ_WIFI_PSK=... \
#        bash prepare-master.sh --noninteractive
#
# 옵션:
#   --noninteractive    환경변수만 사용, 프롬프트 생략
#   --skip-shutdown     마지막 자동 종료 생략 (디버깅용)
# ============================================================

set -euo pipefail

NONINTERACTIVE=false
SKIP_SHUTDOWN=false
for arg in "$@"; do
  case "$arg" in
    --noninteractive) NONINTERACTIVE=true ;;
    --skip-shutdown)  SKIP_SHUTDOWN=true ;;
  esac
done

# ── 색상 ─────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
step()  { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

if [ "$EUID" -ne 0 ]; then
  err "root 권한 필요: sudo bash prepare-master.sh"
  exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Smart Farm — Master Pi 골든 이미지 준비 (1회용)"
echo "════════════════════════════════════════════════════════"
echo ""

# ── 입력 ─────────────────────────────────────────────────
if [ "$NONINTERACTIVE" = false ]; then
  read -p "본인 mac mini 서버의 .env에 있는 BOOTSTRAP_TOKEN 값을 그대로 붙여넣기:
> " BOOTSTRAP_TOKEN
  [ -z "${BOOTSTRAP_TOKEN:-}" ] && { err "BOOTSTRAP_TOKEN 필수"; exit 1; }

  read -p "본부 Wi-Fi SSID [KT_GiGA_5G_5E04]: " HQ_WIFI_SSID
  HQ_WIFI_SSID="${HQ_WIFI_SSID:-KT_GiGA_5G_5E04}"

  read -s -p "본부 Wi-Fi 비밀번호: " HQ_WIFI_PSK
  echo ""
  [ -z "${HQ_WIFI_PSK:-}" ] && { err "Wi-Fi 비밀번호 필수"; exit 1; }
else
  : "${BOOTSTRAP_TOKEN:?BOOTSTRAP_TOKEN 환경변수 필수}"
  : "${HQ_WIFI_SSID:=KT_GiGA_5G_5E04}"
  : "${HQ_WIFI_PSK:?HQ_WIFI_PSK 환경변수 필수}"
fi

# ── 1/7: hostname 통일 ─────────────────────────────────
step "1/7: hostname을 lgw-default 로 통일 (이미지 양산용)"
hostnamectl set-hostname lgw-default
if grep -qE "^127\.0\.1\.1\s" /etc/hosts; then
  sed -i 's/^127\.0\.1\.1\s.*/127.0.1.1 lgw-default/' /etc/hosts
else
  echo "127.0.1.1 lgw-default" >> /etc/hosts
fi
log "hostname=lgw-default"

# ── 2/7: 본부 Wi-Fi 등록 ───────────────────────────────
step "2/7: 본부 Wi-Fi (${HQ_WIFI_SSID}) NetworkManager 프로파일 등록"
# 중복 제거
if nmcli -t -f NAME connection show 2>/dev/null | grep -Fxq "wifi-hq"; then
  nmcli connection delete wifi-hq >/dev/null 2>&1 || true
fi
nmcli connection add type wifi ifname wlan0 \
  con-name wifi-hq \
  ssid "$HQ_WIFI_SSID" \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.psk "$HQ_WIFI_PSK" \
  connection.autoconnect yes \
  connection.autoconnect-priority 100 >/dev/null
log "wifi-hq 프로파일 생성 (autoconnect, priority=100)"

# ── 3/7: eth0 static 192.168.0.100 ─────────────────────
step "3/7: eth0 static IP 192.168.0.100/24 (비상 복구용)"
if nmcli -t -f NAME connection show 2>/dev/null | grep -Fxq "eth0-static"; then
  nmcli connection delete eth0-static >/dev/null 2>&1 || true
fi
# 기본 eth0 dhcp 프로파일은 우선순위 낮추거나 유지 — 일단 static만 추가
nmcli connection add type ethernet ifname eth0 \
  con-name eth0-static \
  ipv4.method manual \
  ipv4.addresses 192.168.0.100/24 \
  ipv4.gateway 192.168.0.1 \
  ipv4.dns "8.8.8.8 1.1.1.1" \
  connection.autoconnect yes \
  connection.autoconnect-priority 50 >/dev/null
log "eth0-static 등록 (192.168.0.100/24, autoconnect)"

# ── 4/7: bootstrap.token + 마커 파일 ───────────────────
step "4/7: /etc/smartfarm/{bootstrap.token,gateway-id,server-ip} 주입"
mkdir -p /etc/smartfarm /var/lib/smartfarm /var/log/smart-farm
echo -n "$BOOTSTRAP_TOKEN" > /etc/smartfarm/bootstrap.token
chmod 600 /etc/smartfarm/bootstrap.token

# gateway-id 강제 lgw-default (양산 충돌 방지 — 마스터 이전 ID가 있으면 덮어씀)
echo -n "lgw-default" > /etc/smartfarm/gateway-id
# server-ip 가 비어 있으면 기본값 채우기 (있으면 유지)
[ -s /etc/smartfarm/server-ip ]  || echo -n "172.30.1.42" > /etc/smartfarm/server-ip

# machine-id 초기화 (양산 시 각 Pi마다 첫 부팅에서 새로 생성되어 unique 보장)
# systemd 표준: /etc/machine-id 가 비어있으면 부팅 시 자동 재생성
truncate -s 0 /etc/machine-id 2>/dev/null || true
rm -f /var/lib/dbus/machine-id 2>/dev/null || true
ln -sf /etc/machine-id /var/lib/dbus/machine-id 2>/dev/null || true

log "bootstrap.token (600), gateway-id=lgw-default (강제), server-ip=$(cat /etc/smartfarm/server-ip), machine-id 초기화"

# ── 5/7: first-boot-init.service 활성 + 마커 제거 ──────
step "5/7: first-boot-init.service 활성 + 양산 마커 제거"
if [ ! -f /etc/systemd/system/first-boot-init.service ]; then
  err "first-boot-init.service가 설치되어 있지 않습니다."
  err "먼저 setup.sh 최신 버전을 실행하세요:"
  err "  sudo bash /tmp/sf-update/setup.sh --noninteractive --skip-update"
  exit 1
fi
systemctl enable first-boot-init.service >/dev/null 2>&1 || true
rm -f /var/lib/smartfarm/.first-boot-done
log "first-boot-init enabled, .first-boot-done 마커 제거"

# ── 6/7: 캐시/로그 정리 (이미지 크기 절감) ─────────────
step "6/7: SD 카드 정리 (apt clean + journal 비우기 + fstrim)"
apt-get clean >/dev/null 2>&1 || true
journalctl --vacuum-time=1d >/dev/null 2>&1 || true
# 임시 파일
rm -rf /tmp/* /var/tmp/* 2>/dev/null || true
# bash history 비우기
truncate -s 0 /root/.bash_history 2>/dev/null || true
truncate -s 0 /home/lgw-default/.bash_history 2>/dev/null || true

# rpi-fallback-channel-sync: fallback-engine 양산 정리
# 마스터에서 누적된 rules.json/SQLite를 모두 제거 →
# 새 Pi가 처음 부팅 시 server의 retained sync 메시지로 자체 매핑 받음
if [ -d /var/lib/smartfarm/fallback ]; then
  systemctl stop fallback-engine 2>/dev/null || true
  rm -f /var/lib/smartfarm/fallback/rules.json
  rm -f /var/lib/smartfarm/fallback/fallback.db
  rm -f /var/lib/smartfarm/fallback/fallback.db-shm
  rm -f /var/lib/smartfarm/fallback/fallback.db-wal
  # 디렉터리 소유권 보정 (pi 유저로 새로 파일 생성 가능하도록)
  if id pi >/dev/null 2>&1; then
    chown -R pi:pi /var/lib/smartfarm/fallback
  fi
  log "fallback-engine 양산 정리: rules.json + fallback.db 제거 + 소유권 pi:pi 보정"
fi

# fstrim (SSD/eMMC 최적화)
fstrim -av >/dev/null 2>&1 || true
sync
log "정리 완료"

# ── 7/7: 자동 종료 ─────────────────────────────────────
step "7/7: 최종 정리 + 자동 종료"
echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅ 마스터 Pi 준비 완료"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  hostname:        lgw-default"
echo "  Wi-Fi:           ${HQ_WIFI_SSID} (autoconnect)"
echo "  eth0:            192.168.0.100/24 (static, 비상복구용)"
echo "  bootstrap token: /etc/smartfarm/bootstrap.token (600)"
echo "  server-ip:       $(cat /etc/smartfarm/server-ip)"
echo "  first-boot-init: enabled (다음 부팅 시 1회 자동 실행)"
echo ""
echo "  ➡ 다음 단계:"
echo "    1. 잠시 후 Pi가 자동 종료됩니다 (30초)"
echo "    2. 전원 LED 꺼지면 SD 카드를 추출"
echo "    3. mac 노트북에 USB 어댑터로 연결"
echo "    4. 노트북에서: cd ~/Projects/smart-farm-mqtt/raspberry-pi"
echo "                  bash build-golden-image.sh"
echo "════════════════════════════════════════════════════════"
echo ""

if [ "$SKIP_SHUTDOWN" = false ]; then
  echo "30초 후 자동 종료... (취소: Ctrl+C)"
  sleep 30
  shutdown -h now
fi
