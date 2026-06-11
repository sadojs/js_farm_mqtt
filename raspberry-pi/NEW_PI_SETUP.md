# 신규 Pi 빌드 절차 — 골든 이미지 사용

> 골든 이미지 `golden-hk-house-20260608.img.xz` 로 신규 라즈베리파이 게이트웨이를 구축하는 표준 절차.

---

## 0. 사전 준비

- macOS (이 가이드 기준)
- SD 카드 (32GB 이상, Class 10+)
- USB SD 카드 리더기
- 골든 이미지 파일: `~/Projects/golden-images/golden-hk-house-20260608.img.xz`
- 서버 운영자로부터 발급 받을 정보:
  - 신규 게이트웨이 ID (예: `farm-001`)
  - bootstrap 토큰 (서버 측에서 생성)
  - 서버 IP/FQDN

---

## 1. SD 카드 굽기

```bash
# 1) SD 카드 식별 (반드시 external/USB만 — 시스템 디스크 절대 금지)
diskutil list external

# 2) clone-sd.sh 로 굽기 (안전 검증 포함)
cd ~/Projects/smart-farm-mqtt/raspberry-pi
bash clone-sd.sh ~/Projects/golden-images/golden-hk-house-20260608.img.xz diskN

# diskN 은 위 1)에서 확인한 식별자 (예: disk6)
# 약 40분 소요 (xz 풀면서 dd, ~10MB/s)
```

쓰기 완료 후 SD 카드를 신규 Pi 에 꽂고 부팅.

---

## 2. 신규 Pi 첫 접속

골든 이미지에는 hk-house 의 정보가 그대로 들어있어 **sanitize 가 반드시 필요**합니다.

### 2-1. SSH 또는 콘솔 접근

신규 Pi 가 부팅되면 hk-house 의 Wi-Fi/eth0 설정이 그대로 적용되므로 같은 네트워크라면 `172.30.1.89` 로 접속 가능 (충돌 위험 — 즉시 sanitize 필요).

```bash
ssh lgwadmin@172.30.1.89
# 비밀번호: Admin123!
```

**또는** HDMI + 키보드 직접 접속.

### 2-2. Sanitize 스크립트 실행

```bash
sudo bash /opt/smart-farm/raspberry-pi/sanitize-new-pi.sh
```

이 스크립트가 자동 처리:
- ✅ smartfarm 식별 정보 제거 (gateway-id / bootstrap.token / server-ip)
- ✅ machine-id 재생성 설정
- ✅ Wi-Fi 자격증명 제거 (eth0 static 은 보존)
- ✅ SSH host key 정리 (재생성 트리거)
- ✅ tunnel key 제거
- ✅ first-boot 마커 제거
- ✅ bash history 정리

모든 정보는 `/root/sanitize-backup-YYYYMMDD-HHMMSS/` 에 백업.

---

## 3. 신규 게이트웨이 등록

### 3-1. setup.sh 재실행

```bash
sudo bash /opt/smart-farm/raspberry-pi/setup.sh \
  --bootstrap-token <NEW_TOKEN> \
  --server-ip <SERVER_IP> \
  --gateway-id <NEW_GATEWAY_ID>
```

또는 (대화형):

```bash
sudo bash /opt/smart-farm/raspberry-pi/setup.sh --with-tunnel
# 프롬프트에서 토큰/서버IP/게이트웨이ID 입력
```

### 3-2. 재부팅 + first-boot-init 실행

```bash
sudo reboot
```

부팅 후 `first-boot-init.service` 가 자동 실행:
- 새 SSH host key 생성
- 새 tunnel keypair 생성
- 서버 `/api/config-deploy/register-tunnel-key` 호출
- 응답으로 받은 정보로 `/etc/smartfarm/gateway-id` 갱신
- `/var/lib/smartfarm/.first-boot-done` 마커 생성

---

## 4. 검증

```bash
# 1) 서비스 상태
systemctl is-active fallback-engine mosquitto zigbee2mqtt config-agent gpio-agent reverse-ssh-tunnel

# 2) 서버 등록 확인 (백엔드 측)
curl http://<SERVER_IP>:3100/api/gateways | jq '.[] | select(.gatewayId == "<NEW_GATEWAY_ID>")'

# 3) 터널 상태
journalctl -u reverse-ssh-tunnel -n 20 --no-pager
```

정상이면:
- 서비스 모두 `active`
- 백엔드 API 에서 신규 게이트웨이 조회 가능
- `tunnelStatus: "connected"`

---

## 5. 정리

```bash
# Sanitize 백업 삭제 (운영 정상 확인 후)
sudo rm -rf /root/sanitize-backup-*
```

---

## 트러블슈팅

### sanitize-new-pi.sh 가 없을 때
골든 이미지가 6/8 추출본이라 sanitize-new-pi.sh 가 포함되어 있지 않을 수 있습니다.
다음 중 하나로 가져오기:

```bash
# macOS 에서 scp 푸시
scp ~/Projects/smart-farm-mqtt/raspberry-pi/sanitize-new-pi.sh lgwadmin@172.30.1.89:/tmp/
ssh lgwadmin@172.30.1.89 'sudo cp /tmp/sanitize-new-pi.sh /opt/smart-farm/raspberry-pi/'

# 또는 git pull (smart-farm 디렉토리에 .git 가 있으면)
cd /opt/smart-farm && sudo git pull
```

### SSH 충돌 (hk-house 와 같은 SSH host key)
첫 SSH 시도가 `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` 로 거부되면:
```bash
ssh-keygen -R 172.30.1.89
```
그 후 재시도. 신규 Pi 의 새 host key 가 등록됨.

---

마지막 검증: 6/10 — 신규 골든 이미지 (hk-house 추출본) 기준
