#!/usr/bin/env bash
# ============================================================
# sanitize-new-pi.sh — 마스터 골든 이미지 추출 직전에 실행하는 sanitize
#
# 목적:
#   마스터 골든 이미지가 신규 Pi 의 자동 등록 흐름(단계 1~3)을 지원하도록
#   "고유 식별 정보만" 제거하고 "자동 등록에 필요한 토큰/설정"은 보존한다.
#
# 사용 시점:
#   1) 마스터 Pi (운영 X) 에서 자동 등록 흐름 검증 후
#   2) 이 스크립트 실행
#   3) shutdown -h now
#   4) SD 카드 추출 → .img.xz
#
# 사용법:
#   sudo bash sanitize-new-pi.sh
#
# 결정 매트릭스 (2026-06-12 운영 결정):
#   보존 항목                                  | 이유
#   ───────────────────────────────────────────┼──────────────────────────────────
#   /etc/smartfarm/bootstrap.token             | first-boot-init 자동 등록 필수
#   /etc/smartfarm/server-ip                   | first-boot-init 자동 등록 필수
#   /etc/smartfarm/fallback-engine.env (GATEWAY_ID placeholder) | 서비스 시작 실패 방지
#   /etc/smartfarm/gpio-agent.env (동일)       | 서비스 시작 실패 방지
#   /etc/NetworkManager/system-connections/wifi-* | 본부 Wi-Fi 자동 연결(단계 3)
#   /etc/NetworkManager/system-connections/eth0-static | 유선 폴백 자동 연결
#
#   제거 항목                                  | 이유
#   ───────────────────────────────────────────┼──────────────────────────────────
#   /etc/smartfarm/gateway-id                  | 백엔드가 새 ID 발급
#   /etc/smartfarm/tunnel.env                  | first-boot-init 이 새로 작성
#   /etc/machine-id                            | systemd 가 첫 부팅에 새로 생성
#   /var/lib/smartfarm/.first-boot-done        | first-boot-init 재실행 가능 상태
#   /etc/ssh/ssh_host_*_key                    | 동일 키 충돌 방지 (첫 부팅 시 재생성)
#   /root/.ssh/tunnel_key                      | first-boot-init 이 새로 발급
#   /etc/hostname                              | lgw-default 로 초기화
#   bash history                               | 보안 (운영 비밀번호 등 잔존 방지)
#
# 신규 Pi 에서의 흐름 (sanitize 적용 후):
#   1. SD 굽기 → 신규 Pi 부팅
#   2. systemd-machine-id-setup → 새 machine-id 생성
#   3. NetworkManager → 본부 Wi-Fi 자동 연결 → DHCP IP 부여
#   4. fallback-engine / gpio-agent — placeholder GATEWAY_ID 로 시작 (정상)
#   5. first-boot-init.service → 새 SSH host key + 새 tunnel key 발급
#   6. POST /api/config-deploy/register-tunnel-key — bootstrap.token 사용
#   7. 백엔드가 새 gateway-id 발급 (lgw-{machineId8자})
#   8. apply-gateway-id.sh — 모든 env 파일 + base_topic 갱신 + 서비스 재시작
#   9. 백엔드 게이트웨이 목록에 자동 등록 (status=online)
#   ⇒ 운영자는 브라우저에서 hostname / 프로덕션 Server IP / 현장 SSID/PW / 장치 설정
# ============================================================

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "이 스크립트는 root 권한이 필요합니다. sudo 로 실행하세요." >&2
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Smart Farm — 마스터 골든 Sanitize"
echo "═══════════════════════════════════════════════════"
echo ""

BAK="/root/sanitize-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BAK"
echo "[1/9] 백업 디렉토리: $BAK"

# ───── 1. smartfarm 서비스 정지 ─────
echo ""
echo "[2/9] smartfarm 서비스 정지..."
systemctl stop fallback-engine config-agent gpio-agent zigbee2mqtt mosquitto reverse-ssh-tunnel 2>/dev/null || true

# ───── 2. /etc/smartfarm 정리 — 보존/제거 정책 적용 ─────
echo ""
echo "[3/9] /etc/smartfarm 정리 — bootstrap.token + server-ip 는 보존..."
mkdir -p "$BAK/etc-smartfarm"
if [[ -d /etc/smartfarm ]]; then
  cp -a /etc/smartfarm/* "$BAK/etc-smartfarm/" 2>/dev/null || true
  # 제거: 신규 Pi 고유 식별 정보
  rm -f /etc/smartfarm/gateway-id
  rm -f /etc/smartfarm/tunnel.env
  # ⚠️ 보존: bootstrap.token, server-ip (자동 등록 필수)
  # ⚠️ 보존: fallback-engine.env, gpio-agent.env (단, GATEWAY_ID 만 placeholder 로)
  # .bak 파일은 정리
  rm -f /etc/smartfarm/*.bak
  echo "  gateway-id, tunnel.env 제거"
  echo "  bootstrap.token, server-ip 보존 (자동 등록 위해)"
fi

# ───── 3. env 파일의 GATEWAY_ID 를 placeholder 로 치환 ─────
echo ""
echo "[4/9] env 파일의 GATEWAY_ID 를 placeholder(lgw-default)로 치환..."
for envf in /etc/smartfarm/fallback-engine.env /etc/smartfarm/gpio-agent.env; do
  if [[ -f "$envf" ]]; then
    sed -i -E 's|^GATEWAY_ID=.*|GATEWAY_ID=lgw-default|' "$envf"
    echo "  $envf → GATEWAY_ID=lgw-default"
  fi
done

# ───── 4. machine-id 재생성 ─────
echo ""
echo "[5/9] machine-id 재생성 설정..."
cp /etc/machine-id "$BAK/machine-id" 2>/dev/null || true
echo -n > /etc/machine-id
[[ -f /var/lib/dbus/machine-id ]] && echo -n > /var/lib/dbus/machine-id
echo "  /etc/machine-id 비움 (다음 부팅 시 systemd-machine-id-setup 가 자동 생성)"

# ───── 5. SSH host key 재생성 트리거 ─────
echo ""
echo "[6/9] SSH host key 제거 (첫 부팅 시 sshd 가 자동 재생성)..."
mkdir -p "$BAK/ssh-host-keys"
cp -a /etc/ssh/ssh_host_*_key* "$BAK/ssh-host-keys/" 2>/dev/null || true
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
echo "  /etc/ssh/ssh_host_*_key 제거"

# ───── 6. tunnel key 제거 ─────
echo ""
echo "[7/9] tunnel key 제거 (first-boot-init 이 새로 발급)..."
[[ -f /root/.ssh/tunnel_key ]] && cp /root/.ssh/tunnel_key* "$BAK/" 2>/dev/null
rm -f /root/.ssh/tunnel_key /root/.ssh/tunnel_key.pub /root/.ssh/known_hosts_tunnel

# ───── 7. first-boot 마커 + hostname 초기화 + bash history ─────
echo ""
echo "[8/9] first-boot 마커 제거 + hostname=lgw-default + bash history..."
rm -f /var/lib/smartfarm/.first-boot-done
cp /etc/hostname "$BAK/hostname" 2>/dev/null || true
echo "lgw-default" > /etc/hostname
hostnamectl set-hostname lgw-default 2>/dev/null || true
# /etc/hosts 의 127.0.1.1 라인도 갱신
sed -i -E "s|^127\.0\.1\.1.*|127.0.1.1\tlgw-default|" /etc/hosts 2>/dev/null || true
rm -f /root/.bash_history /home/*/.bash_history
echo "  hostname=lgw-default, first-boot 마커 제거, bash history 정리"

# ───── 8. NetworkManager Wi-Fi: 본부 Wi-Fi 보존, 다른 자격증명만 정리 ─────
# (현장 SSID/PW 변경은 운영자가 단계 7 에서 백엔드 UI 로 진행)
echo ""
echo "[9/9] Wi-Fi 프로파일: 본부 Wi-Fi(wifi-hq) + 유선(eth0-static) 보존..."
if [[ -d /etc/NetworkManager/system-connections ]]; then
  mkdir -p "$BAK/NetworkManager"
  cp -a /etc/NetworkManager/system-connections/* "$BAK/NetworkManager/" 2>/dev/null || true
  # 기본 정책: 모든 wifi 프로파일은 그대로 둔다 (마스터 골든에 본부 Wi-Fi 가 포함되어 신규 Pi 가 자동 연결)
  # 운영자가 현장 배포 시 백엔드 UI 의 config-deploy 로 SSID/PW 변경
  echo "  보존됨 — 본부 Wi-Fi + 유선 설정"
fi

# ───── 완료 안내 ─────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Sanitize 완료 — 이제 골든 이미지 추출 단계로"
echo "═══════════════════════════════════════════════════"
echo ""
echo "백업: $BAK"
echo ""
echo "다음 단계:"
echo "  1. sync && fstrim -av"
echo "  2. shutdown -h now"
echo "  3. SD 카드를 macOS 에 꽂아 build-golden-image.sh 로 .img.xz 추출"
echo ""
echo "추출된 마스터 골든 이미지로 SD 굽기 후 신규 Pi 부팅하면 자동 등록됩니다."
