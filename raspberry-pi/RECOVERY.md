# Smart Farm Pi — 비상 복구 가이드

> Wi-Fi 연결이 끊겼거나 reverse tunnel이 동작하지 않을 때 라즈베리파이에 접근하는 방법.

## 1. 비상 접근 경로 요약

| 상황 | 접근 경로 | 자격증명 |
|------|----------|---------|
| 정상 운영 | 서버 웹UI → "설정 배포" → 게이트웨이 카드 | JWT (admin / farm_admin) |
| 같은 LAN에 있음 | `ssh lgw-default@<rpi-ip>` | `lgw-default` / `Admin123!` |
| 무선 단절 | **LAN 케이블 직결 → `ssh lgw-default@192.168.0.100`** | 동일 |
| 완전 brick | SD 카드 추출 → 마스터 노트북에서 마운트 | (디스크 직접 편집) |

## 2. LAN 케이블 직결 복구 (가장 흔한 케이스)

골든 이미지는 **eth0를 static IP `192.168.0.100/24`** 로 사전 설정되어 있습니다.

### 2.1 준비물

- 이더넷 케이블 1개
- 노트북 (Mac 또는 Linux)

### 2.2 절차 (macOS 기준)

1. Pi의 LAN 포트에 케이블 연결, 다른 끝을 노트북에 연결.
2. macOS 시스템 설정 → 네트워크 → "이더넷" 선택 → 수동 IP 설정:
   - IP: `192.168.0.50` (Pi의 `.100`과 다르면 무엇이든 OK)
   - 서브넷: `255.255.255.0`
   - 라우터: 비워둠 (또는 `192.168.0.1`)
3. 터미널에서:
   ```bash
   ping 192.168.0.100        # 응답 확인
   ssh lgw-default@192.168.0.100
   # 비밀번호: Admin123!
   ```

### 2.3 접속 후 진단

```bash
# 1. Wi-Fi 상태
nmcli device status
nmcli connection show --active

# 2. 활성 connection 보기
nmcli -t -f NAME,TYPE,DEVICE connection show --active

# 3. 새 Wi-Fi 직접 설정
sudo nmcli connection add type wifi ifname wlan0 \
  con-name "내SSID" ssid "내SSID" \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "비밀번호"
sudo nmcli connection up "내SSID"

# 4. 인터넷 확인
ping -c 3 8.8.8.8
curl -fsS https://1.1.1.1 -o /dev/null && echo OK

# 5. 잘못된 connection 삭제
nmcli connection show
nmcli connection delete "잘못된SSID"

# 6. 서비스 상태
systemctl status zigbee2mqtt config-agent gpio-agent reverse-ssh-tunnel

# 7. 최근 로그
journalctl -u config-agent --since "10 min ago" --no-pager
journalctl -u reverse-ssh-tunnel --since "10 min ago" --no-pager
tail -50 /var/log/smart-farm/apply-wifi.log
```

## 3. 서버 측 확인

서버에서 Pi 상태를 확인:

```bash
# 1. authorized_keys에 tunnel key 있는지
sudo cat /home/pi/.ssh/authorized_keys | grep "tunnel@"

# 2. tunnel 포트 LISTEN 여부
sudo ss -tlnp | grep 22222

# 3. 활동 로그 (게이트웨이 등록 / Wi-Fi 변경 이력)
psql -d smartfarm -c "
  SELECT created_at, action, target_id, details->>'detail'
  FROM activity_logs
  WHERE target_type='gateway'
  ORDER BY created_at DESC LIMIT 20;
"
```

## 4. 완전 복구 (SD 카드 직접 편집)

Pi가 전혀 부팅 안 되는 경우:

1. SD 카드 추출 → macOS USB 어댑터로 마운트
2. `/Volumes/rootfs/etc/NetworkManager/system-connections/` 의 `.nmconnection` 파일 편집
3. 또는 SD 카드를 새로 복제: `bash clone-sd.sh golden-lgw-vX.img.xz diskN`

## 5. 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| `ssh: connection refused` | sshd 미실행 | 마스터 Pi에서 `systemctl enable ssh` 확인 후 재이미지 |
| `192.168.0.100` ping 응답 없음 | eth0-static 미설정 / 다른 IP 점유 | macOS 다른 인터페이스 모두 끔, IP 충돌 확인 |
| Wi-Fi 변경 후 본사에서 연결 안 됨 | 정상 — 새 SSID는 농장에서만 유효 | Pi를 농장으로 발송하거나 LAN 직결로 원복 |
| `nmcli connection up` 실패 | SSID 가시범위 밖 / PSK 오타 | LAN 직결 → nmcli edit 으로 수정 |
| reverse tunnel 미연결 | machine_id 미등록 / 키 미동기 | 서버 `register-tunnel-key` API 수동 호출 또는 `/var/log/smart-farm/first-boot-init.log` 확인 |

## 6. 첫 부팅 (first-boot-init) 수동 트리거

자동 등록이 실패한 경우 강제로 재실행:

```bash
ssh lgw-default@<rpi-ip>
sudo rm -f /var/lib/smartfarm/.first-boot-done
sudo systemctl restart first-boot-init.service
journalctl -u first-boot-init -f
```

서버 측에서 직접 등록 (Pi가 호출 못 하는 경우):

```bash
TOKEN=$(cat /etc/smartfarm/bootstrap.token)
curl -X POST http://172.30.1.42:3100/api/config-deploy/register-tunnel-key \
  -H "Content-Type: application/json" \
  -H "X-Smartfarm-Bootstrap-Token: $TOKEN" \
  -d '{
    "gatewayId": "lgw-default",
    "publicKey": "ssh-ed25519 AAAA...",
    "machineId": "<cat /etc/machine-id 값>",
    "rpiIp": "<현재 IP>"
  }'
```

## 7. 비상 자격증명

| 항목 | 값 |
|------|---|
| SSH 사용자 | `lgw-default` |
| SSH 비밀번호 (이미지 기본) | `Admin123!` (배포 후 반드시 변경) |
| eth0 static IP | `192.168.0.100/24` |
| Gateway / DNS | `192.168.0.1` / `8.8.8.8` |
| Bootstrap token | `/etc/smartfarm/bootstrap.token` (Pi) + `BOOTSTRAP_TOKEN` (서버 env) |

> ⚠️ 보안: 골든 이미지에 기본 비밀번호가 평문으로 들어가 있습니다. **농장에 배포 후 반드시** `passwd` 명령으로 비밀번호 변경, 또는 ConfigDeploy 페이지에서 무선/hostname 변경 시 함께 절차로 진행하세요. (향후 사이클에서 LUKS / TPM 검토 예정)
