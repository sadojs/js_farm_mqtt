# 라즈베리파이 리버스 SSH 터널 계획서

> NAT 뒤 다수의 라즈베리파이를 프로덕션 서버에서 상시 SSH 접속

## 1. 개요

### 1.1 배경

라즈베리파이(Zigbee 게이트웨이)는 각 농장의 NAT 라우터 뒤에 있어 공인 IP가 없다.
프로덕션 서버(공인 IP 보유)에서 직접 SSH 접속이 불가능하다.
**Pi는 1대가 아닌 농장 수만큼 증가**하므로 다중 Pi 운영을 전제로 설계해야 한다.

자동 배포(config-deploy)는 구현되어 있으나, 장애 대응·직접 조작을 위한
SSH 직접 접속 수단이 없어 운영 리스크가 있다.

### 1.2 목표

- 각 Pi가 프로덕션 서버로 역방향(Reverse) SSH 터널을 상시 유지
- **gateway_id 기반으로 Pi별 포트 자동 할당** — 포트 충돌 없이 N대 확장 가능
- 프로덕션 서버에서 `ssh rpi-{gateway_id}` 한 줄로 각 Pi 접속
- 네트워크 단절 시 자동 재연결, 재부팅 후 자동 복구

### 1.3 핵심 제약

| 제약 | 내용 |
|------|------|
| 라즈베리파이 | NAT 뒤, 공인 IP 없음, **N대** 운영 |
| 프로덕션 서버 | 공인 IP 보유, SSH 포트(22) 오픈 |
| 연결 방향 | Pi → Server 만 가능 (Server → Pi 불가) |
| 포트 관리 | Pi마다 **고유 포트** 필요 (충돌 방지) |
| 운영 환경 | 무인 농장, 장기 무중단 필요 |

---

## 2. 기술 선택

### 2.1 후보 비교

| 방식 | 자체 서버 | 다중 Pi | 비용 | 복잡도 | 비고 |
|------|:---------:|:-------:|------|--------|------|
| **autossh** (채택) | ✅ | ✅ 포트별 관리 | 무료 | 낮음 | 업계 표준, 커넥션 감시+재연결 |
| frp | ✅ | ✅ 설정으로 관리 | 무료 | 중간 | 중앙 설정 파일 관리 필요 |
| Tailscale | ❌ 외부 의존 | ✅ 자동 | 무료/유료 | 낮음 | 계정 관리, 외부 의존 |
| WireGuard | ✅ | ✅ | 무료 | 높음 | VPN 서브넷 구성 복잡 |

### 2.2 채택: autossh + systemd + gateway_id 기반 포트 할당

- 추가 인프라 불필요 — 기존 프로덕션 서버만 사용
- Pi별 `gateway_id`로 포트 결정 → 재배포 시에도 동일 포트 유지
- `setup.sh`에 `GATEWAY_ID` 파라미터 하나만 추가하면 자동 설정

---

## 3. 다중 Pi 아키텍처

```
프로덕션 서버 (공인 IP)
│
├── localhost:22201  ◄──[autossh 터널]── Pi-1 (lgw-farm01, NAT 뒤)
├── localhost:22202  ◄──[autossh 터널]── Pi-2 (lgw-farm02, NAT 뒤)
├── localhost:22203  ◄──[autossh 터널]── Pi-3 (lgw-farm03, NAT 뒤)
│       ·
│       ·
└── localhost:2220N  ◄──[autossh 터널]── Pi-N (lgw-farmNN, NAT 뒤)

접속 방법:
  ssh rpi-farm01   →  ssh -p 22201 lgw-dev@localhost  (서버에서)
  ssh rpi-farm02   →  ssh -p 22202 lgw-dev@localhost
```

### 3.1 포트 할당 전략

**방식: DB 기반 정적 할당**

```
gateways 테이블에 tunnel_port 컬럼 추가
- 포트 범위: 22200 ~ 22299 (최대 100대)
- gateway 등록 시 자동 채번 (다음 미사용 포트)
- Pi의 setup.sh가 백엔드 API에서 자신의 포트 조회
```

| gateway_id | tunnel_port | status |
|------------|-------------|--------|
| lgw-farm01 | 22201 | connected |
| lgw-farm02 | 22202 | disconnected |
| lgw-farm03 | 22203 | connected |

**왜 DB 할당인가?**
- Pi가 재배포 되어도 동일 포트 유지 (SSH config 변경 불필요)
- 포트 충돌 원천 차단
- 웹 UI에서 어떤 포트로 접속하면 되는지 확인 가능

---

## 4. 구현 범위

### 4.1 백엔드

- [ ] **`gateways` 테이블 `tunnel_port` 컬럼 추가** (int, nullable)
- [ ] **포트 자동 채번 API** `GET /api/gateways/{id}/tunnel-port`
  - 등록된 포트 있으면 반환, 없으면 22200~22299 중 미사용 포트 채번 후 저장
- [ ] **터널 상태 업데이트** — MQTT `farm/{gatewayId}/tunnel/status` 수신 시 DB 반영
- [ ] **게이트웨이 목록 API에 `tunnelPort`, `tunnelStatus` 포함**

### 4.2 라즈베리파이 측 (Pi)

- [ ] **autossh 설치** (`apt install autossh`)
- [ ] **터널 전용 SSH 키 생성** (Pi별 고유, 패스프레이즈 없음)
- [ ] **systemd 서비스 파일** (`/etc/systemd/system/reverse-ssh-tunnel.service`)
  - 부팅 시 백엔드 API에서 `tunnel_port` 조회 후 autossh 실행
  - `Restart=always`, `RestartSec=10`, `After=network-online.target`
- [ ] **setup.sh 통합** — `GATEWAY_ID` 인자로 전체 자동 설정
- [ ] **config-agent 터널 상태 보고** — MQTT로 connected/disconnected 전송

### 4.3 프로덕션 서버 측

- [ ] **터널 전용 계정 생성** (`tunnel` 계정, 셸 제한)
- [ ] **Pi 공개키 일괄 등록 스크립트** (`authorized_keys` 자동 추가)
- [ ] **SSH config 자동 생성 스크립트** — DB에서 게이트웨이 목록 조회해 alias 생성
  ```
  # ~/.ssh/config 자동 생성 예시
  Host rpi-farm01
      HostName localhost
      Port 22201
      User lgw-dev
  ```
- [ ] **`/etc/ssh/sshd_config`**: `ClientAliveInterval 60`, `ClientAliveCountMax 3`

### 4.4 웹 UI (게이트웨이 관리)

- [ ] **터널 포트 및 접속 상태 표시** — 게이트웨이 카드에 `● 터널 연결됨 (:22201)` 표시
- [ ] **접속 명령 복사 버튼** — `ssh rpi-farm01` 클립보드 복사

---

## 5. setup.sh 플로우 (신규 Pi 등록 시)

```bash
# 관리자가 신규 Pi에서 실행
sudo bash setup.sh --gateway-id lgw-farm03 --server prod.example.com

# 내부 동작:
# 1. autossh 설치
# 2. 터널 전용 키 쌍 생성 (/etc/ssh/tunnel_key)
# 3. 백엔드 API 호출 → tunnel_port 채번 (예: 22203)
# 4. 공개키를 백엔드로 전송 (서버 authorized_keys 자동 등록)
# 5. systemd 서비스 파일 생성 (포트 22203 하드코딩)
# 6. 서비스 활성화 및 시작
# 7. 터널 연결 확인 출력
```

---

## 6. 보안 고려사항

| 항목 | 조치 |
|------|------|
| 터널 전용 키 | Pi별 고유 키 페어, 시스템 계정과 완전 분리 |
| 터널 계정 제한 | 서버의 `tunnel` 계정에 `/usr/sbin/nologin` 셸 설정 |
| authorized_keys | `restrict,port-forwarding` 옵션으로 포트포워딩만 허용 |
| 포트 범위 | 22200-22299 방화벽에서 외부 차단, 내부만 접근 |
| Pi 공개키 관리 | 백엔드 DB에 저장, 탈퇴 시 authorized_keys에서 제거 |

---

## 7. 구현 우선순위

| 순서 | 항목 | 중요도 |
|------|------|--------|
| 1 | gateways 테이블 tunnel_port 컬럼 + 채번 API | 필수 |
| 2 | autossh systemd 서비스 (Pi) | 필수 |
| 3 | 프로덕션 서버 tunnel 계정 + authorized_keys | 필수 |
| 4 | setup.sh 통합 (자동화) | 높음 |
| 5 | SSH config 자동 생성 스크립트 | 높음 |
| 6 | 웹 UI 터널 상태 표시 | 중간 |

---

## 8. 성공 기준

- [ ] Pi N대 각각 고유 포트로 동시 터널 유지
- [ ] Pi 재부팅 후 60초 이내 동일 포트로 터널 자동 복구
- [ ] 프로덕션 서버에서 `ssh rpi-{id}` 접속 성공
- [ ] setup.sh 실행 시 포트 채번~터널 시작까지 완전 자동
- [ ] 웹 UI에서 각 Pi의 터널 연결 상태 실시간 확인

---

## 9. 관련 파일

- `raspberry-pi/setup.sh` — Pi 초기화 스크립트 (통합 대상)
- `raspberry-pi/config-agent/index.js` — MQTT 상태 보고 (터널 상태 추가)
- `backend/src/modules/gateway-manager/` — 게이트웨이 관리 (tunnel_port 추가)
- `backend/database/schema.sql` — gateways 테이블 스키마
