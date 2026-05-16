#!/usr/bin/env bash
# tunnel-setup.sh — 라즈베리파이 리버스 SSH 터널 설치 스크립트
#
# 사용법:
#   sudo GATEWAY_ID=lgw-farm01 \
#        BACKEND_URL=http://172.30.1.10:3100 \
#        SERVER_HOST=172.30.1.10 \
#        SERVER_USER=ohjeongseok \
#        bash tunnel-setup.sh
#
# 환경변수:
#   GATEWAY_ID    — 게이트웨이 ID (필수)
#   BACKEND_URL   — 백엔드 URL (필수)
#   SERVER_HOST   — 프로덕션(또는 테스트) 서버 IP/호스트 (필수)
#   SERVER_USER   — 서버 SSH 계정 (기본: pi)
#   SERVER_PORT   — 서버 SSH 포트 (기본: 22)
#   TUNNEL_USER   — Pi에서 터널을 실행할 계정 (기본: lgw-dev)

set -euo pipefail

GATEWAY_ID="${GATEWAY_ID:?GATEWAY_ID 환경변수가 필요합니다}"
BACKEND_URL="${BACKEND_URL:?BACKEND_URL 환경변수가 필요합니다}"
SERVER_HOST="${SERVER_HOST:?SERVER_HOST 환경변수가 필요합니다}"
SERVER_USER="${SERVER_USER:-pi}"
SERVER_PORT="${SERVER_PORT:-22}"
TUNNEL_USER="${TUNNEL_USER:-lgw-dev}"

KEY_DIR="/home/${TUNNEL_USER}/.ssh"
KEY_FILE="${KEY_DIR}/tunnel_rsa"
SERVICE_FILE="/etc/systemd/system/reverse-ssh-tunnel.service"

# root 권한 확인
if [ "$EUID" -ne 0 ]; then
  echo "❌ root 권한이 필요합니다. 'sudo bash tunnel-setup.sh' 로 실행하세요." >&2
  exit 1
fi

# 터널 전용 사용자 자동 생성 (없으면)
if ! id -u "${TUNNEL_USER}" >/dev/null 2>&1; then
  echo "  [INFO] 터널 전용 사용자 '${TUNNEL_USER}' 자동 생성"
  useradd -m -s /bin/bash "${TUNNEL_USER}"
fi

echo "========================================"
echo " 리버스 SSH 터널 설치 시작"
echo " 게이트웨이: ${GATEWAY_ID}"
echo " 서버: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PORT}"
echo "========================================"

# ── 1. autossh 설치 ──────────────────────────────
echo "[1/6] autossh 설치 중..."
apt-get install -y -qq autossh curl jq openssh-client 2>/dev/null || true

# ── 2. SSH 키 생성 ────────────────────────────────
echo "[2/6] 터널 전용 SSH 키 생성 중..."
mkdir -p "${KEY_DIR}"
chown "${TUNNEL_USER}:${TUNNEL_USER}" "${KEY_DIR}"
chmod 700 "${KEY_DIR}"

if [ ! -f "${KEY_FILE}" ]; then
  sudo -u "${TUNNEL_USER}" ssh-keygen -t rsa -b 4096 -f "${KEY_FILE}" -N "" \
    -C "tunnel-${GATEWAY_ID}@$(hostname)"
  echo "  새 키 생성 완료: ${KEY_FILE}"
else
  echo "  기존 키 사용: ${KEY_FILE}"
fi

PUBLIC_KEY=$(cat "${KEY_FILE}.pub")

# ── 3. 백엔드에 공개키 등록 + 포트 채번 ──────────────
echo "[3/6] 백엔드에 터널 포트 요청 및 공개키 등록 중..."

# 포트 채번 (인증 없이 접근 가능한 내부 엔드포인트)
TUNNEL_PORT=$(curl -sf "${BACKEND_URL}/api/gateways/${GATEWAY_ID}/tunnel-port" \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: ${GATEWAY_ID}" 2>/dev/null | jq -r '.port' 2>/dev/null || echo "")

if [ -z "$TUNNEL_PORT" ] || [ "$TUNNEL_PORT" = "null" ]; then
  echo "  ⚠️  백엔드 포트 조회 실패 — 기본 포트 22201 사용"
  TUNNEL_PORT=22201
fi

echo "  할당된 터널 포트: ${TUNNEL_PORT}"

# 공개키 등록 (백엔드가 서버 authorized_keys에 자동 추가)
curl -sf -X POST "${BACKEND_URL}/api/gateways/${GATEWAY_ID}/tunnel-key" \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: ${GATEWAY_ID}" \
  -d "{\"publicKey\": \"${PUBLIC_KEY}\"}" > /dev/null 2>&1 && \
  echo "  공개키 등록 완료" || \
  echo "  ⚠️  공개키 자동 등록 실패 — 수동 등록 필요 (아래 키를 서버에 추가하세요):"

echo "  Public Key: ${PUBLIC_KEY}"

# ── 4. known_hosts에 서버 키 추가 (StrictHostKeyChecking 우회) ──
echo "[4/6] 서버 호스트 키 등록 중..."
sudo -u "${TUNNEL_USER}" bash -c "
  mkdir -p ${KEY_DIR}
  ssh-keyscan -p ${SERVER_PORT} ${SERVER_HOST} >> ${KEY_DIR}/known_hosts 2>/dev/null
  sort -u ${KEY_DIR}/known_hosts -o ${KEY_DIR}/known_hosts
  chmod 600 ${KEY_DIR}/known_hosts
"

# ── 5. systemd 서비스 생성 ────────────────────────
echo "[5/6] systemd 서비스 생성 중..."
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Reverse SSH Tunnel to Production Server (${GATEWAY_ID})
After=network-online.target
Wants=network-online.target

[Service]
User=${TUNNEL_USER}
Restart=always
RestartSec=10
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 \\
  -o "ServerAliveInterval=30" \\
  -o "ServerAliveCountMax=3" \\
  -o "ExitOnForwardFailure=yes" \\
  -o "StrictHostKeyChecking=no" \\
  -o "IdentityFile=${KEY_FILE}" \\
  -N \\
  -R ${TUNNEL_PORT}:localhost:22 \\
  -p ${SERVER_PORT} \\
  ${SERVER_USER}@${SERVER_HOST}

[Install]
WantedBy=multi-user.target
EOF

# ── 6. 서비스 활성화 및 시작 ─────────────────────
echo "[6/6] 서비스 시작 중..."
systemctl daemon-reload
systemctl enable reverse-ssh-tunnel.service
systemctl restart reverse-ssh-tunnel.service

sleep 3
STATUS=$(systemctl is-active reverse-ssh-tunnel.service 2>/dev/null || echo "unknown")

echo ""
echo "========================================"
if [ "$STATUS" = "active" ]; then
  echo " ✅ 터널 서비스 시작 완료!"
  echo " 게이트웨이: ${GATEWAY_ID}"
  echo " 터널 포트:  ${TUNNEL_PORT}"
  echo ""
  echo " 서버에서 접속:"
  echo "   ssh -p ${TUNNEL_PORT} ${TUNNEL_USER}@localhost"
else
  echo " ⚠️  서비스 상태: ${STATUS}"
  echo " 로그 확인: sudo journalctl -u reverse-ssh-tunnel -n 20"
fi
echo "========================================"
echo ""
echo "📋 서버에 수동으로 추가해야 할 공개키:"
echo "${PUBLIC_KEY}"
