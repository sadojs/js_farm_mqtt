# Raspberry Pi Zigbee Gateway 설정 가이드

라즈베리파이를 Zigbee Gateway로 설정하는 가이드입니다.

## 준비물

| 항목 | 설명 |
|------|------|
| Raspberry Pi 4/5 | 2GB 이상 권장 |
| microSD 카드 | 16GB 이상 |
| Tuya ZNDongle-E | Zigbee 코디네이터 (USB) |
| USB 연장 케이블 | (권장) 라즈베리파이 USB 간섭 방지용 |
| 이더넷 또는 WiFi | 로컬 네트워크 연결 |

## 설치 방법

### 방법 1: SD카드 이미지 복사 (권장)

가장 빠른 방법입니다. 설정된 이미지를 SD카드에 굽기만 하면 됩니다.

```bash
# 1. Raspberry Pi Imager로 OS 굽기
#    - OS: Raspberry Pi OS Lite (64-bit)
#    - 설정: SSH 활성화, WiFi 설정, 사용자명/비밀번호 설정

# 2. SD카드가 마운트되면 raspberry-pi 폴더 복사
cp -r raspberry-pi/ /Volumes/bootfs/smart-farm/

# 3. SD카드를 라즈베리파이에 삽입, 부팅

# 4. SSH 접속
ssh pi@라즈베리파이IP

# 5. 설치 스크립트 실행
cd /boot/firmware/smart-farm   # 또는 복사한 위치
sudo bash setup.sh
```

### 방법 2: 원격 설치

이미 라즈베리파이가 실행 중이라면:

```bash
# 맥에서 파일 전송
scp -r raspberry-pi/ pi@라즈베리파이IP:~/smart-farm/

# SSH 접속 후 설치
ssh pi@라즈베리파이IP
cd ~/smart-farm
sudo bash setup.sh
```

## 설치 후 확인

### 서비스 상태 확인
```bash
# Mosquitto 상태
sudo systemctl status mosquitto

# Zigbee2MQTT 상태
sudo systemctl status zigbee2mqtt

# Zigbee2MQTT 로그 실시간
journalctl -u zigbee2mqtt -f
```

### USB 디바이스 확인
```bash
# ZNDongle-E 연결 확인
ls -la /dev/ttyUSB*
# 또는
ls -la /dev/ttyZigbee
```

### MQTT 통신 테스트
```bash
# 터미널 1: 구독 (모든 zigbee2mqtt 메시지)
mosquitto_sub -h localhost -t 'zigbee2mqtt/#' -v

# 터미널 2: Zigbee2MQTT 브릿지 상태 확인
mosquitto_sub -h localhost -t 'zigbee2mqtt/bridge/state'
```

## Zigbee 장비 페어링

1. 브라우저에서 `http://라즈베리파이IP:8080` 접속
2. 상단 "Permit join (All)" 클릭 (페어링 모드 활성화)
3. Zigbee 장비의 페어링 버튼 길게 누르기 (장비별 상이)
4. 장비가 목록에 나타나면 이름 지정
5. 센서: 자동으로 데이터 전송 시작
6. 스위치: `zigbee2mqtt/{이름}/set` 토픽으로 제어 가능

## MQTT 토픽 구조

```
zigbee2mqtt/bridge/state           → {"state":"online"}  (브릿지 상태)
zigbee2mqtt/bridge/devices         → [{...}]             (페어링된 장비 목록)
zigbee2mqtt/{장비이름}              → {"temperature":25.3,"humidity":60}  (센서 데이터)
zigbee2mqtt/{장비이름}/availability → {"state":"online"}  (장비 온라인 상태)
zigbee2mqtt/{장비이름}/set          ← {"state":"ON"}      (장비 제어 명령)
```

## 맥미니 연결 설정

라즈베리파이 IP를 확인한 후 맥미니의 `.env`를 수정합니다:

```bash
# smart-farm-mqtt/.env
MQTT_URL=mqtt://192.168.x.x:1883    # 라즈베리파이 IP
ZIGBEE2MQTT_URL=http://192.168.x.x:8080
```

## 문제 해결

### ZNDongle-E가 인식 안됨
```bash
# USB 디바이스 목록 확인
lsusb
# Silicon Labs CP210x가 보여야 함

# 드라이버 확인
dmesg | grep -i cp210
```

### Zigbee2MQTT 시작 실패
```bash
# 로그 확인
journalctl -u zigbee2mqtt -n 50 --no-pager

# 수동 실행 (디버그)
cd /opt/zigbee2mqtt
node index.js
```

### MQTT 연결 안됨
```bash
# Mosquitto 상태
sudo systemctl status mosquitto

# 포트 확인
ss -tlnp | grep 1883

# 방화벽 확인
sudo ufw status
sudo ufw allow 1883
sudo ufw allow 8080
```

### 장비가 페어링 안됨
- ZNDongle-E를 **USB 연장 케이블**로 라즈베리파이에서 떨어뜨리기 (USB 3.0 간섭 방지)
- Zigbee2MQTT 웹UI에서 "Permit join" 활성화 확인
- 장비의 리셋/페어링 방법 확인 (장비별 상이)
