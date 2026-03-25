# Plan: 라즈베리파이 설정 원격 배포 (MQTT 기반)

## 개요

맥미니 서버에서 등록된 라즈베리파이 게이트웨이에 Zigbee2MQTT 설정을 MQTT를 통해 원격 배포/업데이트하는 기능.
전체 또는 선택한 게이트웨이에 일괄 배포 가능.

## 문제 정의

- 현재 라즈베리파이 설정 변경 시 각각 SSH 접속하여 수동 수정해야 함
- 게이트웨이가 늘어날수록 관리 부담 증가
- 수동 작업 중 실수로 게이트웨이 고유값(ID, network_key 등)을 덮어쓸 위험
- **라즈베리파이가 NAT 뒤에 있어 서버에서 SSH 직접 접근 불가**

## 해결 방안: MQTT 채널 활용

라즈베리파이는 이미 맥미니의 MQTT Broker에 연결되어 있으므로, 이 채널을 역방향 설정 배포에 활용:

```
맥미니 (Backend)                     라즈베리파이 (Config Agent)
     │                                      │
     ├─ MQTT publish ─────────────────────▶ │ farm/{gw}/config/update 구독
     │  (공통 설정 JSON)                     │ → 보호필드 보존하며 머지
     │                                      │ → configuration.yaml 덮어쓰기
     │                                      │ → Z2M 서비스 재시작
     │ ◀──────────── MQTT publish ──────── │ farm/{gw}/config/result
     │  (성공/실패 결과)                     │
```

- NAT/방화벽 무관 (기존 MQTT 아웃바운드 연결 활용)
- 추가 포트 오픈 불필요
- 라즈베리파이에 경량 Node.js 스크립트(Config Agent) 하나만 추가

## 핵심 요구사항

### 기능 요구사항

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-01 | 등록된 게이트웨이 목록에서 배포 대상 선택 (전체/개별) | 높음 |
| FR-02 | Zigbee2MQTT 공통 설정 편집 및 배포 | 높음 |
| FR-03 | 배포 전 현재 설정 조회 및 diff 미리보기 | 높음 |
| FR-04 | 게이트웨이 고유값 보호 (ID, network_key, pan_id) | **필수** |
| FR-05 | 배포 결과 실시간 확인 (성공/실패/타임아웃) | 높음 |
| FR-06 | 배포 후 Zigbee2MQTT 서비스 자동 재시작 | 높음 |
| FR-07 | 배포 이력 관리 (누가, 언제, 무엇을) | 낮음 |

### 비기능 요구사항

| ID | 요구사항 |
|----|----------|
| NFR-01 | MQTT 기반 통신 (NAT 환경 대응, 추가 포트 불필요) |
| NFR-02 | 배포 실패 시 롤백 가능 (이전 설정 백업) |
| NFR-03 | Config Agent 경량화 (라즈베리파이 리소스 최소 사용) |
| NFR-04 | 응답 타임아웃 처리 (게이트웨이 오프라인 대응) |

## 설정 분류 체계

### 보호 필드 (절대 덮어쓰지 않음)

```yaml
mqtt.base_topic          # 게이트웨이 ID 포함 (farm/{ID}/z2m)
mqtt.server              # MQTT Broker 주소
advanced.network_key     # Zigbee 네트워크 고유 키
advanced.pan_id          # Zigbee PAN ID
serial.port              # 하드웨어 의존
serial.adapter           # 하드웨어 의존
devices                  # 페어링된 장비 목록
groups                   # Zigbee 그룹 목록
```

### 공통 설정 (배포 대상)

```yaml
homeassistant, frontend, advanced.log_level, advanced.channel,
advanced.last_seen, advanced.legacy_api, advanced.legacy_availability_payload,
availability, ota
```

## 구현 범위

| 영역 | 변경 내용 |
|------|-----------|
| 라즈베리파이 | Config Agent 스크립트 추가 + systemd 서비스 등록 |
| Backend | ConfigDeploy 모듈 신규 (MQTT publish + 결과 수신) |
| Frontend | 게이트웨이 관리에 설정 배포 UI 추가 |
| setup.sh | Config Agent 설치 단계 추가 |

## 위험 요소 및 대응

| 위험 | 대응 |
|------|------|
| 게이트웨이 ID 덮어쓰기 | 보호 필드 목록 하드코딩 + Config Agent 측에서도 이중 검증 |
| network_key 변경 → 장비 전부 끊김 | 보호 필드 + 서버/에이전트 양쪽 검증 |
| Config Agent 미설치 게이트웨이 | 타임아웃 처리 + "Config Agent 미응답" 상태 표시 |
| MQTT 메시지 유실 | QoS 1 사용 + 응답 대기 + 재시도 |
