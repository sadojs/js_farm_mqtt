#!/usr/bin/env bash
# ============================================================
# clone-sd.sh — 골든 이미지를 SD 카드에 dd 복제 (macOS)
#
# 사용법:
#   bash clone-sd.sh <golden.img.xz> <disk-id>
#   예: bash clone-sd.sh golden-lgw-20260519.img.xz disk4
#
# 안전 검증:
#   - 외부(USB) 디스크만 허용
#   - 시스템 디스크 거부
#   - 사용자 확인 3회
# ============================================================

set -euo pipefail

IMG="${1:-}"
DISK="${2:-}"

if [[ -z "$IMG" || -z "$DISK" ]]; then
  echo "사용법: bash clone-sd.sh <golden.img.xz> <disk-id>" >&2
  echo "  예: bash clone-sd.sh golden-lgw-20260519.img.xz disk4" >&2
  exit 1
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "이 스크립트는 macOS에서만 동작합니다." >&2
  exit 1
fi

if [[ ! -f "$IMG" ]]; then
  echo "이미지 파일을 찾을 수 없습니다: $IMG" >&2
  exit 1
fi

if [[ ! "$DISK" =~ ^disk[0-9]+$ ]]; then
  echo "잘못된 디스크 식별자: $DISK (예: disk4)" >&2
  exit 1
fi

# 안전 검증: external + ≤ 64GB
INTERNAL=$(diskutil info "/dev/${DISK}" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}' || echo "")
if [[ "$INTERNAL" == "Internal" ]]; then
  echo "거부: ${DISK}는 내부 디스크입니다." >&2
  exit 1
fi
# rpi-golden-image-build-fix BUG-2: diskutil "Disk Size:" 라인의 괄호 안 Bytes만 정확 추출
SIZE_BYTES=$(diskutil info "/dev/${DISK}" 2>/dev/null | sed -nE 's/.*Disk Size:[^(]+\(([0-9]+) Bytes\).*/\1/p' | head -1)
[[ -z "$SIZE_BYTES" ]] && SIZE_BYTES=0
if [[ -n "$SIZE_BYTES" && "$SIZE_BYTES" -gt $((68 * 1000 * 1000 * 1000)) ]]; then
  echo "거부: ${DISK} 용량이 64GB 초과 — 안전상 차단" >&2
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SD Card Cloner"
echo "═══════════════════════════════════════════════════"
echo "  Source : ${IMG}"
echo "  Target : /dev/${DISK}"
echo ""
diskutil info "/dev/${DISK}" | head -10
echo ""
echo "⚠️  /dev/${DISK} 의 모든 데이터가 삭제됩니다."
echo ""
read -r -p "확인 1/3 — 대상이 맞습니까? (yes): " C1
[[ "$C1" == "yes" ]] || { echo "취소됨"; exit 1; }
read -r -p "확인 2/3 — 디스크 식별자를 다시 입력: " C2
[[ "$C2" == "$DISK" ]] || { echo "디스크 식별자 불일치 — 취소"; exit 1; }
read -r -p "확인 3/3 — 복제 진행하려면 'CLONE' 입력: " C3
[[ "$C3" == "CLONE" ]] || { echo "취소됨"; exit 1; }

echo ""
echo "▶ unmount"
diskutil unmountDisk "/dev/${DISK}"

echo "▶ dd (xz → /dev/r${DISK})"
# rpi-golden-image-build-fix: SUDO_ASKPASS 지원 (background/CI 자동화)
if [ -n "${SUDO_ASKPASS:-}" ]; then
  xzcat "$IMG" | sudo -A dd of="/dev/r${DISK}" bs=4m status=progress
else
  xzcat "$IMG" | sudo dd of="/dev/r${DISK}" bs=4m status=progress
fi

echo "▶ sync"
sync

echo "▶ eject"
diskutil eject "/dev/${DISK}" || true

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ 복제 완료"
echo "═══════════════════════════════════════════════════"
echo "  SD 카드를 Pi에 꽂고 부팅하세요."
echo "  본부 Wi-Fi(KT_GiGA_5G_5E04) 자동 연결 후 reverse"
echo "  tunnel + first-boot-init.service 가 자동 실행됩니다."
echo "═══════════════════════════════════════════════════"
