#!/usr/bin/env bash
# ============================================================
# sanitize-new-pi.sh — 골든 이미지로 부팅한 신규 Pi 의 hk-house 식별 정보 제거
#
# 사용 시점: 골든 이미지를 SD 로 복사한 후 신규 Pi 에 꽂아 첫 부팅한 직후
#           SSH (172.30.1.89) 또는 직접 콘솔로 접속하여 실행
#
# 사용법:
#   sudo bash sanitize-new-pi.sh
#
# 효과:
#   - hk-house 의 gateway-id / bootstrap.token / server-ip 제거
#   - machine-id 재생성 (다음 부팅 시 자동)
#   - Wi-Fi 자격증명 제거
#   - SSH host key 재생성 트리거
#   - first-boot-init 마커 제거 (재실행 가능 상태)
#
# 이후:
#   sudo bash setup.sh --bootstrap-token NEW_TOKEN --server-ip SERVER_IP
#   (NEW_TOKEN, SERVER_IP 는 서버 운영자가 발급)
# ============================================================

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "이 스크립트는 root 권한이 필요합니다. sudo 로 실행하세요." >&2
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Smart Farm — 신규 Pi Sanitize"
echo "═══════════════════════════════════════════════════"
echo ""

# 백업 디렉토리 (만약 실수로 sanitize 했을 때 복원 가능)
BAK="/root/sanitize-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BAK"
echo "[1/8] 백업 생성: $BAK"

# ───── 1. smartfarm 서비스 정지 ─────
echo ""
echo "[2/8] smartfarm 서비스 정지..."
systemctl stop fallback-engine config-agent gpio-agent zigbee2mqtt mosquitto reverse-ssh-tunnel 2>/dev/null || true

# ───── 2. smartfarm 식별 파일 백업 + 삭제 ─────
echo ""
echo "[3/8] smartfarm 식별 정보 제거..."
mkdir -p "$BAK/etc-smartfarm"
if [[ -d /etc/smartfarm ]]; then
  cp -a /etc/smartfarm/* "$BAK/etc-smartfarm/" 2>/dev/null || true
  rm -f /etc/smartfarm/gateway-id
  rm -f /etc/smartfarm/bootstrap.token
  rm -f /etc/smartfarm/server-ip
  rm -f /etc/smartfarm/tunnel.env
  rm -f /etc/smartfarm/fallback-engine.env /etc/smartfarm/fallback-engine.env.bak
  rm -f /etc/smartfarm/gpio-agent.env /etc/smartfarm/gpio-agent.env.bak
  echo "  /etc/smartfarm/ 정리 완료 (백업: $BAK/etc-smartfarm)"
fi

# ───── 3. machine-id 재생성 ─────
echo ""
echo "[4/8] machine-id 재생성 설정..."
cp /etc/machine-id "$BAK/machine-id" 2>/dev/null || true
echo -n > /etc/machine-id
[[ -f /var/lib/dbus/machine-id ]] && echo -n > /var/lib/dbus/machine-id
echo "  /etc/machine-id 비움 (다음 부팅 시 systemd-machine-id-setup 가 자동 생성)"

# ───── 4. Wi-Fi 자격증명 제거 ─────
echo ""
echo "[5/8] Wi-Fi 자격증명 제거..."
if [[ -d /etc/NetworkManager/system-connections ]]; then
  mkdir -p "$BAK/NetworkManager"
  cp -a /etc/NetworkManager/system-connections/* "$BAK/NetworkManager/" 2>/dev/null || true
  # eth0 static 는 유지, Wi-Fi 만 제거
  find /etc/NetworkManager/system-connections -name '*.nmconnection' | while read -r f; do
    if grep -q "type=wifi" "$f" 2>/dev/null; then
      echo "  제거: $(basename "$f")"
      rm -f "$f"
    fi
  done
fi

# ───── 5. SSH host key 재생성 ─────
echo ""
echo "[6/8] SSH host key 정리 (재생성은 first-boot-init 또는 다음 부팅 시)..."
mkdir -p "$BAK/ssh-host-keys"
cp -a /etc/ssh/ssh_host_*_key* "$BAK/ssh-host-keys/" 2>/dev/null || true
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
echo "  /etc/ssh/ssh_host_*_key 제거"

# ───── 6. tunnel key 제거 ─────
echo ""
echo "[7/8] tunnel key 제거 (first-boot-init 이 새로 발급)..."
[[ -f /root/.ssh/tunnel_key ]] && cp /root/.ssh/tunnel_key* "$BAK/" 2>/dev/null
rm -f /root/.ssh/tunnel_key /root/.ssh/tunnel_key.pub

# ───── 7. first-boot 마커 제거 + bash history 정리 ─────
echo ""
echo "[8/8] first-boot 마커 + bash history 정리..."
rm -f /var/lib/smartfarm/.first-boot-done
rm -f /root/.bash_history /home/*/.bash_history
echo "  /var/lib/smartfarm/.first-boot-done 제거"
echo "  bash history 정리"

# ───── 완료 안내 ─────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Sanitize 완료"
echo "═══════════════════════════════════════════════════"
echo ""
echo "백업 위치: $BAK"
echo ""
echo "다음 단계:"
echo "  1. setup.sh 재실행"
echo "     sudo bash /opt/smart-farm/raspberry-pi/setup.sh \\"
echo "       --bootstrap-token <NEW_TOKEN> \\"
echo "       --server-ip <SERVER_IP> \\"
echo "       --gateway-id <NEW_GATEWAY_ID>"
echo ""
echo "  2. 또는 재부팅하여 first-boot-init.service 실행"
echo "     단, 사전에 /etc/smartfarm/ 에 bootstrap.token + server-ip + gateway-id 필요"
echo ""
echo "  3. 정상 운영 확인 후 백업 삭제"
echo "     sudo rm -rf $BAK"
