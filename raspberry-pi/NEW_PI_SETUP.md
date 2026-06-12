# 신규 Pi 빌드 절차 — 마스터 골든 이미지 사용

> 마스터 골든 이미지로 신규 라즈베리파이 게이트웨이를 빌드하는 표준 절차.
> 운영자 의도된 흐름(단계 1~8) 100% 자동/반자동 동작 지원.

---

## 사용자 의도된 흐름

| # | 단계 | 자동/수동 |
|---|---|---|
| 1 | SD 카피 | 🛠 수동 (macOS) |
| 2 | 신규 Pi 부팅 | 🛠 수동 |
| 3 | **자동 wifi 연결 + IP 부여 + 개발 서버 자동 등록** | 🤖 **자동** |
| 4 | hostname 변경 | 👤 브라우저 (게이트웨이 시스템 설정) |
| 5 | 기능 테스트 | 👤 검증 |
| 6 | Server IP → 프로덕션 IP 변경 | 👤 브라우저 |
| 7 | 원하는 hostname + 현장 SSID/PW 입력 | 👤 브라우저 |
| 8 | 장치 등록 + 사용 | 👤 브라우저 |

---

## 0. 사전 준비

- macOS (clone-sd.sh / build-golden-image.sh 작동 환경)
- SD 카드 (32GB 이상, Class 10+)
- USB SD 카드 리더기 (가능하면 USB 3.0 — 쓰기 속도 60~70 MB/s)
- 마스터 골든 이미지 (예: `~/Projects/golden-images/golden-master-20260611.img.xz`)

---

## 1. SD 카드 굽기 (단계 1)

```bash
diskutil list external                  # SD 식별 (예: disk6)
cd ~/Projects/smart-farm-mqtt/raspberry-pi
bash clone-sd.sh ~/Projects/golden-images/golden-master-20260611.img.xz diskN
```

약 10~15분 소요 (USB3 + Class 10 SD 기준).

---

## 2. 신규 Pi 부팅 (단계 2)

SD를 신규 Pi 에 꽂고 전원 켜기. 약 1~2분 대기.

**부팅 시 자동 처리되는 것**:
- `systemd-machine-id-setup` → 새 machine-id 생성
- NetworkManager → 본부 Wi-Fi 자동 연결 → DHCP IP 부여
- `first-boot-init.service`:
  - 새 SSH host key 생성
  - 새 tunnel keypair 발급
  - `POST /api/config-deploy/register-tunnel-key` (bootstrap.token 사용)
  - 응답으로 받은 `lgw-{machineId8자}` 로 모든 env 파일 + base_topic 자동 갱신
  - `.first-boot-done` 마커 생성
- 모든 smartfarm 서비스 active
- `config-agent` 가 백엔드에 heartbeat 전송 → status=online

---

## 3. 자동 등록 확인 (단계 3)

```bash
# 백엔드에 새 게이트웨이가 자동으로 등록됐는지 확인
curl -s http://localhost:3100/api/gateways \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:3100/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"...."}' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')" \
  | python3 -m json.tool | head -40
```

정상이면 `lgw-{shortMid}` 형태의 새 게이트웨이가 보이며 `status=online, agentStatus=online, tunnelStatus=connected`.

---

## 4. 운영자 작업 (단계 4~8) — 모두 브라우저 UI

### 단계 4: hostname 변경

1. https://&lt;개발 서버&gt;:5174/login → admin 로그인
2. 게이트웨이 관리 → `lgw-{shortMid}` 선택
3. 시스템 설정 → hostname 입력 + 저장
4. 자동 재부팅 후 적용 확인

### 단계 5: 기능 테스트

- 백엔드 ↔ Pi MQTT 양방향 통신
- 자동 제어 룰 / 장치 제어 / 폴백 엔진 / Zigbee 등

### 단계 6: Server IP → 프로덕션 IP 변경

1. 게이트웨이 시스템 설정 → Server IP 입력
2. 신규 Pi 가 프로덕션 서버에 다시 등록 (machine-id 기준 자동 인식)

### 단계 7: hostname + SSID/PW 현장 입력

1. 게이트웨이 시스템 설정 → hostname / SSID / PW 입력 + 저장
2. 신규 Pi 가 새 자격증명으로 재연결 시도

### 단계 8: 장치 등록 + 사용

브라우저에서 정상 운영.

---

## 마스터 골든 이미지 만들기 (참고)

> 운영자가 새 마스터 골든 이미지를 만들어야 할 때

1. **마스터 Pi 준비** (운영 X, 검증용 Pi):
   - hk-house 의 일반적 운영 상태로 동작 중
   - 골든 이미지 인 SD 로 부팅한 후 정상 운영 확인

2. **sanitize 실행**:
   ```bash
   sudo bash /opt/smart-farm/raspberry-pi/sanitize-new-pi.sh
   ```

3. **sync + 종료**:
   ```bash
   sync && sudo fstrim -av
   sudo shutdown -h now
   ```

4. **macOS 에서 추출** — `build-golden-image.sh` 또는 SSH 라이브 dd:
   ```bash
   ssh pi@<master> 'sudo dd if=/dev/mmcblk0 bs=4M | xz -T4 -1' > golden-master-YYYYMMDD.img.xz
   ```

5. **sha256 검증** + JSON metadata 작성:
   ```bash
   shasum -a 256 golden-master-YYYYMMDD.img.xz > golden-master-YYYYMMDD.img.xz.sha256
   ```

---

## 트러블슈팅

### Wi-Fi 자동 연결 안 될 때

마스터 골든 이미지에 본부 Wi-Fi 가 들어있어야 자동 연결됩니다. 만약 빠져있다면:

1. SD 다시 macOS 에 꽂기
2. bootfs (FAT32) 에 `firstrun.sh` + `cmdline.txt` systemd.run 지시자 추가:
   ```bash
   # firstrun.sh 안에 NetworkManager nmconnection 작성
   # cmdline.txt 끝에 systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target
   ```

### 자동 등록 실패 (`required env file missing`)

`bootstrap.token` 또는 `server-ip` 가 골든 이미지에 빠진 경우. **반드시 보존** 해야 함. `sanitize-new-pi.sh` 의 보존 정책 확인.

### 서비스 시작 실패 (`Failed to load environment files`)

`fallback-engine.env` 또는 `gpio-agent.env` 가 sanitize 로 사라진 경우. 두 파일은 **보존** 하고 `GATEWAY_ID` 만 placeholder 로 변경해야 함. `apply-gateway-id.sh` 가 자동으로 실제 ID 로 갱신함.

---

## 변경 이력

- **2026-06-12**: 자동 등록 흐름 100% 작동 검증 (`lgw-82cc8893`). sanitize 정책 수정:
  - 보존: `bootstrap.token`, `server-ip`, `fallback-engine.env`, `gpio-agent.env`, Wi-Fi 자격증명
  - 제거: `gateway-id`, `machine-id`, `.first-boot-done`, SSH host key, tunnel key, hostname → `lgw-default`
