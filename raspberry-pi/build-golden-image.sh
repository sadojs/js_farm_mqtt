#!/usr/bin/env bash
# ============================================================
# build-golden-image.sh — 마스터 Pi → 골든 이미지 (.img.xz) 추출
#
# 환경: macOS (Homebrew xz / diskutil 필요)
#
# 사전 준비 (마스터 Pi 측에서 수행):
#   1. sudo bash setup.sh --with-tunnel 으로 모든 컴포넌트 정상화
#   2. /etc/smartfarm/{gateway-id,server-ip,bootstrap.token} 설정 확인
#   3. NetworkManager 본부 Wi-Fi(KT_GiGA_5G_5E04) 등록
#      sudo nmcli connection add type wifi ifname wlan0 con-name wifi-hq \
#        ssid "KT_GiGA_5G_5E04" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "PASSWORD"
#   4. eth0 static 등록
#      sudo nmcli connection add type ethernet ifname eth0 con-name eth0-static \
#        ipv4.method manual ipv4.addresses 192.168.0.100/24 \
#        ipv4.gateway 192.168.0.1 ipv4.dns "8.8.8.8 1.1.1.1"
#   5. systemctl enable first-boot-init.service
#   6. sudo rm -f /var/lib/smartfarm/.first-boot-done  # 골든 이미지엔 마커 없어야 함
#   7. sudo apt clean && sudo fstrim -av && sudo shutdown -h now
#   8. SD 카드를 macOS에 USB 어댑터로 연결
#
# 사용법:
#   bash build-golden-image.sh [output_name]
#   (output_name 미지정 시 golden-lgw-YYYYMMDD.img.xz)
# ============================================================

set -euo pipefail

OUTPUT_NAME="${1:-golden-lgw-$(date +%Y%m%d).img.xz}"
WORK_DIR="$(pwd)"
RAW_IMG="${WORK_DIR}/.golden-raw.img"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "이 스크립트는 macOS에서만 동작합니다." >&2
  exit 1
fi

# 도구 확인
for cmd in diskutil dd xz shasum; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "필요 도구 미설치: $cmd (brew install xz)" >&2
    exit 1
  }
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Golden Image Builder"
echo "═══════════════════════════════════════════════════"
echo ""
diskutil list external physical
echo ""

read -r -p "추출할 SD 카드 디스크 식별자 (예: disk4) [반드시 external/USB만]: " DISK
if [[ -z "${DISK}" || ! "$DISK" =~ ^disk[0-9]+$ ]]; then
  echo "잘못된 디스크 식별자: ${DISK}" >&2
  exit 1
fi

# 안전 검증: external + removable + ≤ 64GB
# diskutil "Disk Size:" 라인은 "31.9 GB (31914983424 Bytes) (...)" 형식 — 괄호 안의 정수 Bytes만 추출
SIZE_BYTES=$(diskutil info "/dev/${DISK}" 2>/dev/null | sed -nE 's/.*Disk Size:[^(]+\(([0-9]+) Bytes\).*/\1/p' | head -1)
[[ -z "$SIZE_BYTES" ]] && SIZE_BYTES=0
INTERNAL=$(diskutil info "/dev/${DISK}" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}' || echo "")

if [[ "$INTERNAL" == "Internal" ]]; then
  echo "거부: ${DISK}는 내부 디스크입니다." >&2
  exit 1
fi
if [[ -n "$SIZE_BYTES" && "$SIZE_BYTES" -gt $((68 * 1000 * 1000 * 1000)) ]]; then
  echo "거부: ${DISK} 용량 ${SIZE_BYTES} bytes — 64GB 초과는 안전상 차단" >&2
  exit 1
fi

echo ""
echo "선택한 디스크 정보:"
diskutil info "/dev/${DISK}" | head -10
echo ""
read -r -p "확인 1/3 — 위 디스크가 골든 이미지를 추출할 마스터 Pi의 SD 카드가 맞습니까? (yes): " CONF1
[[ "$CONF1" == "yes" ]] || { echo "취소됨"; exit 1; }
read -r -p "확인 2/3 — 이 디스크의 데이터를 .img로 추출합니다. 디스크 식별자를 다시 입력: " CONF2
[[ "$CONF2" == "$DISK" ]] || { echo "디스크 식별자 불일치 — 취소"; exit 1; }
read -r -p "확인 3/3 — 추출 진행하려면 'BUILD' 입력: " CONF3
[[ "$CONF3" == "BUILD" ]] || { echo "취소됨"; exit 1; }

echo ""
echo "▶ unmount"
diskutil unmountDisk "/dev/${DISK}"

# rpi-golden-image-mass-production v2: dd | xz 파이프로 raw 30GB 임시파일 안 만듦
# (디스크 공간 부족 환경 대응 — 최종 압축 파일 ~1GB만 디스크에 씀)
# SUDO_ASKPASS 환경변수가 설정되어 있으면 자동 password 입력 (-A 옵션)
echo "▶ dd | xz 파이프 → ${OUTPUT_NAME} (raw 임시파일 없이 직접 압축)"
if [ -n "${SUDO_ASKPASS:-}" ]; then
  sudo -A dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
else
  sudo dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
fi

echo "▶ SHA256"
shasum -a 256 "${WORK_DIR}/${OUTPUT_NAME}" | tee "${WORK_DIR}/${OUTPUT_NAME}.sha256"

cat > "${WORK_DIR}/${OUTPUT_NAME%.img.xz}.json" <<META
{
  "image": "${OUTPUT_NAME}",
  "builtAt": "$(date -Iseconds)",
  "builtBy": "$(whoami)@$(hostname)",
  "sourceDisk": "${DISK}",
  "sizeBytes": "${SIZE_BYTES}",
  "note": "rpi-golden-image-system feature, base: Raspberry Pi OS Lite 64-bit Bookworm"
}
META

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ 골든 이미지 생성 완료"
echo "═══════════════════════════════════════════════════"
echo "  파일: ${WORK_DIR}/${OUTPUT_NAME}"
echo "  메타: ${WORK_DIR}/${OUTPUT_NAME%.img.xz}.json"
echo ""
echo "  복제: bash clone-sd.sh ${OUTPUT_NAME} <disk-id>"
echo "═══════════════════════════════════════════════════"
