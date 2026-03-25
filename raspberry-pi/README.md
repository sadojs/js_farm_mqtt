# Raspberry Pi Zigbee Gateway 설치 가이드

스마트팜 MQTT 플랫폼의 Zigbee 게이트웨이로 라즈베리파이를 설정하는 가이드입니다.

## 시스템 구성

```
라즈베리파이 (게이트웨이)              맥미니 (서버)
┌───────────────────────┐         ┌──────────────────────┐
│ Zigbee2MQTT           │         │ Mosquitto (Broker)   │
│   - Zigbee 장비 관리   │──MQTT──▶│ Backend (NestJS)     │
│   - 센서 데이터 수집   │         │ Frontend (Vue 3)     │
│ Config Agent          │         │ PostgreSQL + Redis   │
│   - 원격 설정 배포 수신 │         │                      │
│ Tuya ZNDongle-E (USB) │         │                      │
└───────────────────────┘         └──────────────────────┘
```

- MQTT Broker는 **맥미니에서 실행** (방식 A: 중앙 Broker)
- 라즈베리파이는 Zigbee2MQTT + Config Agent만 실행
- 라즈베리파이가 NAT 뒤에 있어도 동작 (아웃바운드 MQTT 연결)

---

## 준비물

| 항목 | 설명 | 비고 |
|------|------|------|
| Raspberry Pi 4 또는 5 | 2GB 이상 | 4B 2GB면 충분 |
| microSD 카드 | 16GB 이상 | 32GB 권장 |
| Tuya ZNDongle-E | Zigbee 코디네이터 (USB) | [구매 링크 검색: "Tuya ZNDongle-E"] |
| USB 연장 케이블 | 30cm 이상 | USB 3.0 간섭 방지용, **강력 권장** |
| 전원 어댑터 | 5V 3A (USB-C) | 공식 전원 권장 |
| 이더넷 케이블 또는 WiFi | 네트워크 연결용 | 유선 권장 (안정성) |
| SD카드 리더기 | 맥에서 SD카드 굽기용 | |

또한 맥미니에서 미리 확인할 것:
- 맥미니의 IP 주소 (예: `172.30.1.60`)
- 맥미니에서 Mosquitto(MQTT Broker)가 실행 중인지 확인
- 게이트웨이에 부여할 ID (예: `farm01`, `farm02`)

---

## Step 1: Raspberry Pi Imager 설치 (맥에서)

```bash
brew install --cask raspberry-pi-imager
```

또는 https://www.raspberrypi.com/software/ 에서 다운로드

---

## Step 2: SD카드에 OS 굽기

### 2-1. Raspberry Pi Imager 실행

Spotlight(Cmd+Space)에서 "Raspberry Pi Imager" 검색하여 실행

### 2-2. 디바이스 선택

- **Raspberry Pi Device** 클릭
- 사용할 모델 선택 (Raspberry Pi 4 또는 Raspberry Pi 5)

### 2-3. OS 선택

- **Operating System** 클릭
- **Raspberry Pi OS (other)** 선택
- **Raspberry Pi OS Lite (64-bit)** 선택
  - Lite = 데스크톱 GUI 없음 (서버용, 가볍고 빠름)
  - 64-bit = 라즈베리파이 4/5용

### 2-4. SD카드 선택

- **Storage** 클릭
- SD카드 리더기에 꽂은 SD카드 선택
- **주의: 선택한 SD카드의 모든 데이터가 삭제됩니다**

### 2-5. 사전 설정 (중요!)

**Next** 버튼을 누르면 **"Use OS customisation?"** 팝업이 뜹니다.

**"Edit Settings"** 클릭하여 아래 설정:

#### General 탭

| 항목 | 값 | 설명 |
|------|-----|------|
| Set hostname | `smartfarm-gw01` | 게이트웨이별 다르게 (gw01, gw02...) |
| Set username and password | 사용자: `pi`, 비밀번호: 원하는 값 | SSH 접속용 |
| Configure wireless LAN | WiFi SSID + 비밀번호 | 유선 사용 시 생략 가능 |
| Set locale settings | Time zone: `Asia/Seoul` | |

#### Services 탭

| 항목 | 값 |
|------|-----|
| Enable SSH | **체크** (반드시!) |
| Use password authentication | 선택 |

#### 설정 저장

- **Save** 클릭
- **"Use OS customisation?"** 에서 **Yes** 클릭
- **"All existing data will be erased"** 에서 **Yes** 클릭
- 굽기 시작 (약 3~5분 소요)

### 2-6. 굽기 완료 후 설정 파일 복사

**굽기가 완료되면 SD카드를 뽑지 마세요!**

SD카드의 `bootfs` 파티션이 맥에 자동 마운트됩니다. 여기에 스마트팜 설정 파일을 복사합니다:

```bash
# 프로젝트 디렉토리로 이동
cd /Users/ohjeongseok/Projects/smart-farm-mqtt

# raspberry-pi 폴더 전체를 SD카드에 복사
cp -r raspberry-pi/ /Volumes/bootfs/smart-farm/
```

복사 확인:
```bash
ls /Volumes/bootfs/smart-farm/
# 출력: README.md  config-agent  mosquitto  setup.sh  systemd  zigbee2mqtt
```

이제 SD카드를 안전하게 추출합니다:
```bash
diskutil eject /Volumes/bootfs
```

---

## Step 3: 라즈베리파이 첫 부팅

### 3-1. 하드웨어 연결

1. SD카드를 라즈베리파이에 삽입
2. **Tuya ZNDongle-E를 USB 연장 케이블에 연결** → 라즈베리파이 USB 포트에 연결
   - 직접 꽂지 말고 **반드시 연장 케이블** 사용 (USB 3.0 전파 간섭 방지)
   - 라즈베리파이 5는 USB 2.0 포트(검정색)에 연결 권장
3. 이더넷 케이블 연결 (유선 사용 시)
4. 전원 연결 → 자동 부팅 시작

### 3-2. 첫 부팅 대기

- 첫 부팅 시 약 1~2분 소요 (파티션 확장, 설정 적용)
- 녹색 LED가 깜빡이다가 안정되면 부팅 완료

### 3-3. IP 주소 확인

라즈베리파이의 IP를 찾는 방법:

```bash
# 방법 1: 호스트네임으로 찾기 (Imager에서 설정한 hostname)
ping smartfarm-gw01.local

# 방법 2: 공유기 관리 페이지에서 연결된 디바이스 확인

# 방법 3: nmap으로 네트워크 스캔 (같은 네트워크에서)
# brew install nmap  (최초 1회)
nmap -sn 172.30.1.0/24 | grep -B2 "Raspberry"
```

---

## Step 4: SSH 접속 및 설치 스크립트 실행

### 4-1. SSH 접속

```bash
ssh pi@172.30.1.xx    # 라즈베리파이 IP로 변경
# 또는
ssh pi@smartfarm-gw01.local
```

비밀번호: Imager에서 설정한 비밀번호 입력

### 4-2. 설치 파일 위치 확인

```bash
ls /boot/firmware/smart-farm/
# 출력: README.md  config-agent  mosquitto  setup.sh  systemd  zigbee2mqtt
```

만약 Step 2-6에서 파일을 못 복사했다면, 맥에서 원격으로 전송:
```bash
# 맥의 터미널에서 (SSH가 아닌 새 터미널)
scp -r /Users/ohjeongseok/Projects/smart-farm-mqtt/raspberry-pi/ pi@172.30.1.xx:~/smart-farm/
```

### 4-3. 설치 스크립트 실행

```bash
cd /boot/firmware/smart-farm    # 또는 ~/smart-farm
sudo bash setup.sh
```

스크립트가 물어보는 것:

```
============================================
  Smart Farm MQTT - Zigbee Gateway Setup
  방식 A: 중앙 Broker 연결
============================================

게이트웨이 ID (예: farm01): farm01          ← 이 파이의 고유 ID 입력
맥미니(서버) IP 주소 (예: 172.30.1.60): 172.30.1.60    ← 맥미니 IP 입력
```

이후 자동으로 진행됩니다 (약 5~10분):

```
[INFO] Step 1/5: 시스템 업데이트...
[INFO] Step 2/5: Node.js 20.x 설치...
[INFO] Step 3/5: Zigbee2MQTT 설치...          ← 가장 오래 걸림 (npm ci)
[INFO] Step 4/5: USB 권한 및 서비스 등록...
[INFO] Step 5/5: Config Agent 설치...

============================================
  설치 완료!
============================================

  게이트웨이 ID:     farm01
  MQTT 토픽:         farm/farm01/z2m/#
  Zigbee2MQTT 웹UI:  http://172.30.1.xx:8080
  연결 대상 Broker:   mqtt://172.30.1.60:1883

  Config Agent:      MQTT 기반 원격 설정 관리
    설정 배포 토픽:   farm/farm01/config/request
    자동 롤백:       60초 내 MQTT 재연결 실패 시
```

---

## Step 5: 설치 확인

### 5-1. 서비스 상태 확인

```bash
# Zigbee2MQTT 상태
sudo systemctl status zigbee2mqtt
# ● zigbee2mqtt.service - Zigbee2MQTT - Smart Farm Gateway (farm01)
#   Active: active (running) ← 이렇게 나와야 함

# Config Agent 상태
sudo systemctl status config-agent
# ● config-agent.service - Smart Farm Config Agent (farm01)
#   Active: active (running) ← 이렇게 나와야 함
```

### 5-2. Zigbee2MQTT 로그 확인

```bash
journalctl -u zigbee2mqtt -f
# Zigbee2MQTT:info  - MQTT connected       ← Broker 연결 성공
# Zigbee2MQTT:info  - Coordinator started  ← ZNDongle-E 정상 인식
```

`Ctrl+C`로 로그 보기 중단

### 5-3. USB 디바이스 확인

```bash
ls -la /dev/ttyUSB*
# /dev/ttyUSB0 ← ZNDongle-E가 인식됨

# 또는 symlink 확인
ls -la /dev/ttyZigbee
```

### 5-4. Zigbee2MQTT 웹 UI 접속

맥 브라우저에서: `http://172.30.1.xx:8080`

- Zigbee2MQTT 대시보드가 표시되면 성공
- 좌측 상단에 "Permit join" 버튼이 보여야 함

---

## Step 6: 맥미니 웹서비스에서 게이트웨이 등록

1. 스마트팜 웹 (`http://localhost:5174`) 접속
2. **장비 관리** 페이지로 이동
3. 게이트웨이 추가:
   - 게이트웨이 ID: `farm01` (setup.sh에서 입력한 값)
   - 이름: `1동 하우스` (원하는 이름)
   - 위치: `하우스 1동` (선택)

---

## Step 7: Zigbee 장비 페어링

### 7-1. 페어링 모드 활성화

Zigbee2MQTT 웹 UI (`http://172.30.1.xx:8080`)에서:
- 상단 **"Permit join (All)"** 클릭
- 또는 스마트팜 웹의 게이트웨이 관리에서 "페어링" 버튼 클릭

### 7-2. Zigbee 장비 페어링

| 장비 종류 | 페어링 방법 |
|-----------|------------|
| 온습도 센서 | 배터리 넣기 → 리셋 버튼 5초 누르기 |
| 스마트 스위치 | 전원 ON 후 버튼 10초 길게 누르기 (LED 깜빡임) |
| 도어 센서 | 배터리 넣기 → 리셋 핀 누르기 |

장비별 페어링 방법은 제조사 매뉴얼 참조.

### 7-3. 페어링 확인

Zigbee2MQTT 웹 UI의 장비 목록에 새 장비가 나타나면 성공:
- **Friendly name** 지정 (예: `house1_temp_sensor`)
- 센서: 자동으로 데이터 전송 시작
- 스위치: 제어 테스트 가능

---

## 두 번째 라즈베리파이 추가하기

### 방법 A: 같은 과정 반복

Step 2부터 반복하되:
- hostname: `smartfarm-gw02`
- 게이트웨이 ID: `farm02`
- 서버 IP: 동일 (맥미니)

### 방법 B: 마스터 이미지 복제 (3대 이상일 때 권장)

```bash
# 1. 완성된 파이의 SD카드를 맥에 연결
diskutil list                    # disk번호 확인 (예: disk4)

# 2. 이미지 뜨기
sudo dd if=/dev/rdisk4 of=~/smartfarm-master.img bs=4m status=progress

# 3. 새 SD카드에 굽기
sudo dd if=~/smartfarm-master.img of=/dev/rdisk4 bs=4m status=progress

# 4. 새 파이 부팅 후 SSH 접속하여 ID 변경
ssh pi@새파이IP
sudo sed -i 's/farm01/farm02/g' /opt/zigbee2mqtt/data/configuration.yaml
sudo sed -i 's/farm01/farm02/g' /etc/systemd/system/zigbee2mqtt.service
sudo sed -i 's/farm01/farm02/g' /etc/systemd/system/config-agent.service
sudo hostnamectl set-hostname smartfarm-gw02
sudo systemctl daemon-reload
sudo systemctl restart zigbee2mqtt config-agent
```

---

## MQTT 토픽 구조

이 프로젝트에서 사용하는 MQTT 토픽:

```
farm/{게이트웨이ID}/z2m/{장비이름}               → 센서 데이터 (JSON)
farm/{게이트웨이ID}/z2m/{장비이름}/set           ← 장비 제어 명령
farm/{게이트웨이ID}/z2m/{장비이름}/availability  → 온라인/오프라인
farm/{게이트웨이ID}/z2m/bridge/state             → 게이트웨이 상태
farm/{게이트웨이ID}/z2m/bridge/devices           → 페어링된 장비 목록
farm/{게이트웨이ID}/config/request               ← 서버→파이: 설정 배포 요청
farm/{게이트웨이ID}/config/response              → 파이→서버: 설정 배포 결과
```

---

## 문제 해결

### ZNDongle-E가 인식 안됨

```bash
# USB 디바이스 확인
lsusb
# "Silicon Labs CP210x" 또는 "QinHeng Electronics" 가 보여야 함

# 커널 드라이버 확인
dmesg | tail -20
# cp210x 또는 ch341 관련 메시지가 있어야 함

# 해결: USB 연장 케이블 사용, 다른 USB 포트에 연결
```

### Zigbee2MQTT 시작 실패

```bash
# 로그 확인
journalctl -u zigbee2mqtt -n 50 --no-pager

# 수동 실행 (디버그)
cd /opt/zigbee2mqtt
node index.js

# 흔한 원인:
# - /dev/ttyUSB0 없음 → ZNDongle-E 연결 확인
# - MQTT 연결 실패 → 맥미니 Mosquitto 확인, IP 확인
# - permission denied → udev 룰 확인: cat /etc/udev/rules.d/99-zigbee.rules
```

### MQTT Broker 연결 안됨

```bash
# 맥미니에서 Mosquitto 확인 (맥미니 터미널에서)
docker compose ps | grep mosquitto
# sfm-mosquitto   running   0.0.0.0:1883->1883/tcp

# 라즈베리파이에서 연결 테스트
apt install -y mosquitto-clients
mosquitto_pub -h 172.30.1.60 -t "test" -m "hello"
# 오류 없으면 성공

# 방화벽 문제 시 (맥미니에서)
# macOS는 기본적으로 방화벽 OFF
# 만약 켜져있다면: 시스템 설정 > 네트워크 > 방화벽 > 1883 포트 허용
```

### Config Agent 미동작

```bash
# 서비스 상태
sudo systemctl status config-agent

# 로그 확인
journalctl -u config-agent -n 30 --no-pager

# 환경변수 확인
cat /etc/systemd/system/config-agent.service | grep Environment
# GATEWAY_ID=farm01
# MQTT_SERVER=mqtt://172.30.1.60:1883
```

### 장비가 페어링 안됨

1. ZNDongle-E를 **USB 연장 케이블**로 파이에서 떨어뜨리기 (30cm 이상)
2. Zigbee2MQTT 웹 UI에서 "Permit join" 활성화 확인
3. 장비를 ZNDongle-E **1m 이내**에서 페어링 시도
4. 장비의 리셋/페어링 방법 재확인 (제조사별 상이)
5. 채널 변경 (기본 11 → 15 또는 20): 서버 웹 설정 배포에서 변경 가능

---

## 설치된 서비스 요약

| 서비스 | 경로 | 설명 |
|--------|------|------|
| zigbee2mqtt | `/opt/zigbee2mqtt/` | Zigbee-MQTT 브릿지 |
| config-agent | `/opt/smart-farm/config-agent/` | 원격 설정 배포 에이전트 |

```bash
# 서비스 관리 명령어
sudo systemctl start/stop/restart zigbee2mqtt
sudo systemctl start/stop/restart config-agent

# 로그 보기
journalctl -u zigbee2mqtt -f
journalctl -u config-agent -f

# 부팅 시 자동 시작 설정 (setup.sh에서 이미 설정됨)
sudo systemctl enable zigbee2mqtt config-agent
```
