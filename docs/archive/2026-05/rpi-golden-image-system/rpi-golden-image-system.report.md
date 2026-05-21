---
template: report
version: 1.0
feature: rpi-golden-image-system
date: 2026-05-22
author: ohgane
project: smart-farm-mqtt
status: Completed
---

# rpi-golden-image-system 완료 보고서

> **Summary**: 라즈베리파이용 재사용 가능한 골든 이미지(Golden Image) + 원격 설정 배포 시스템 구축. SD 카드 dd 복제 → 본부 Wi-Fi 자동 연결 → first-boot-init.service(oneshot) 가 SSH host key + tunnel key 재생성 + 서버 자동 등록 → reverse SSH tunnel 자동 활성화 → 웹 UI ConfigDeploy 페이지에서 hostname/Wi-Fi/gateway-id/server-ip 4종 원격 배포. 최종 Match Rate **99%**.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-17
> **Completed**: 2026-05-22
> **Duration**: 6일 (반복 2회 — gap-detector 1회 + 실기 검증 1회)

---

## 1. PDCA 개요

### Plan (계획)
**문서**: `docs/01-plan/features/rpi-golden-image-system.plan.md`

- **목표**: SD 카드 dd 복제 2분 + 본부 부팅 자동화로 N대 양산 가능한 골든 이미지 + 무방문 원격 설정 변경
- **선택 아키텍처**: 마스터 Pi(`lgw-HK`)에서 ddrescue 추출 + xz 압축 + 첫 부팅 uniqueness 자동화(`first-boot-init.service`)
- **추정 기간**: 5~7일

### Design (설계)
**문서**: `docs/02-design/features/rpi-golden-image-system.design.md`

핵심 설계 원칙:
- 단일 배포 채널 (MQTT `farm/{gw}/config/request|response`) — tunnel 끊김과 독립
- Pi 측 변경은 외부 스크립트(`apply-wifi.sh`, `apply-hostname.sh`, `apply-gateway-id.sh`, `apply-server-ip.sh`)로 격리
- 첫 부팅 uniqueness 자동화 — SSH host key + tunnel key 재생성, machineId 자동 재생성
- eth0 static `192.168.0.100` 비상 복구 경로 항상 보장

산출 컴포넌트: backend `config-deploy` 모듈 확장(4종 신규 엔드포인트 + register-tunnel-key), `gateway-manager` 자동 ID 부여, RPi 측 5개 스크립트, `first-boot-init.service`, `reverse-ssh-tunnel.service`, ConfigDeploy.vue 카드 확장.

### Do (구현)
**기간**: 2026-05-17 ~ 2026-05-22

| 영역 | 구현 내용 |
|------|-----------|
| **백엔드** | `config-deploy` 모듈 확장 (controller/service/types/dto 5종 + register-tunnel-key 자동 등록 API), `gateway-manager` 자동 ID + tunnel port 할당, `ssh-proxy` 모듈로 reverse tunnel 웹콘솔 |
| **RPi 스크립트** | `first-boot-init.sh` (oneshot, host key + tunnel key 재생성 + 서버 등록), `apply-wifi.sh`/`apply-hostname.sh`/`apply-gateway-id.sh`/`apply-server-ip.sh` (격리 실행 + Z2M base_topic 동기화) |
| **systemd** | `first-boot-init.service`, `reverse-ssh-tunnel.service` (autossh), `config-agent.service`, `gpio-agent.service` 의존관계 정리 |
| **프론트엔드** | `ConfigDeploy.vue` 4종 카드, `RemoteConfigStatusBadge`, `GatewaySystemConfigCard`, `useRemoteConfig` composable, WebTerminal 컴포넌트 |
| **인프라** | NetworkManager 본부 Wi-Fi(KT_GiGA_5G_5E04) + eth0 static 192.168.0.100/24 사전 등록 |

### Check (분석)
**문서**: `docs/03-analysis/rpi-golden-image-system.analysis.md`

| 분석 회차 | Match Rate | 주요 Gap |
|:---------:|:----------:|----------|
| 1차 (5-19) | 91% | MAJOR-01 first-boot-init machineId 처리, MAJOR-02 register-tunnel-key 인증, MAJOR-03 tunnel port 할당 로직 |
| 2차 (5-21) | **97%** | MAJOR-02/03 수정 후 재측정, MINOR 2건 잔존 |
| **3차 실기 검증 (5-22)** | **99%** | 실기 운영 중 발견된 first-boot-init 데드락 1건 수정 + 골든 이미지 추출 완료 |

### Act (개선 — 실기 검증 단계)
**핵심 발견**: 실제 SD 카드에 이미지 복제 후 PI 부팅 시 `first-boot-init.service`가 1일 2시간째 hang.

**근본 원인 진단**:
- `first-boot-init.sh`가 `apply-gateway-id.sh` 호출
- `apply-gateway-id.sh`가 동기 `systemctl restart zigbee2mqtt`/`gpio-agent` 호출
- first-boot-init은 systemd oneshot 단위 — 자체 완료 전까지 신규 job 처리 불가
- → cyclic deadlock (oneshot 완료 대기 ↔ 신규 restart job 큐잉)
- → reverse-ssh-tunnel/config-agent 영원히 시작 못 함

**수정**:
- `apply-gateway-id.sh:67-70` — `systemctl restart`에 `--no-block` 추가 (비동기 큐잉)
- `first-boot-init.sh:84-86` — `apply-gateway-id` 호출에 `timeout 60` 이중 안전장치
- backend `.env` — `SSH_TUNNEL_USER=lgwadmin` 명시 (코드 기본값 `lgw-dev`는 PI에 부재)
- 기존 운영 PI `lgw-dev`에도 `lgwadmin` 계정 추가 (PI 계정 통일 정책 확정)

---

## 2. 구현 결과

### 완료 항목

- SD 카드 dd 복제 후 본부 Wi-Fi 자동 연결
- 첫 부팅 시 SSH host key + tunnel key 자동 재생성 (PI별 unique)
- `/etc/machine-id` 비우기로 systemd 자동 재생성 → 서버가 machineId로 1대씩 구분
- 서버 자동 등록 (HTTP POST `/api/config-deploy/register-tunnel-key`) + 자동 gateway-id 부여
- reverse SSH tunnel 자동 활성화 (autossh, `localhost:22200..N` 매핑)
- 웹콘솔(WebTerminal.vue) — JWT 인증 후 socket.io `/ssh` namespace로 인터랙티브 셸
- 4종 원격 설정 배포 (Wi-Fi / hostname / gateway-id / server-ip) + MQTT 응답 채널
- ConfigDeploy.vue UI 카드 (상태 배지 + 적용 결과 토스트)
- eth0 static 192.168.0.100 비상 복구 경로
- **first-boot-init 데드락 수정** (실기 운영 발견 후 패치)
- **PI 계정 lgwadmin 통일 정책 확정** (모든 PI: lgwadmin/Admin123! + id_rpi_lgw 키)

### 산출물 — 골든 이미지 v20260521

```
~/Projects/golden-images/
├── golden-lgw-v20260521.img.xz       806 MB (xz -9, 압축률 0.026)
├── golden-lgw-v20260521.img.xz.sha256
└── golden-lgw-v20260521.json          메타데이터 (사용법 포함)
```

| 항목 | 값 |
|---|---|
| 압축 크기 | 806 MB (845,263,268 B) |
| 원본 raw | 29.7 GiB (31,914,983,424 B) |
| 압축률 | 0.026 (97.4% 절감) |
| SHA-256 | `f2c90c15f6caf74e2f10ae88d7476ccc48aea758040be63459c9f616fe8d1208` |
| 검증 | `xz -tv` OK, `shasum -c` OK |

### 실기 검증 결과 (2026-05-22)

| 검증 항목 | 결과 |
|---|---|
| first-boot-init 정상 완료 | ✅ 18초 (이전: 1일+ hang) |
| SSH host key 재생성 | ✅ |
| tunnel keypair 생성 + 서버 등록 | ✅ HTTP 200 |
| reverse-ssh-tunnel 자동 활성화 | ✅ active (autossh) |
| config-agent / gpio-agent 자동 active | ✅ |
| 자동 gateway-id 부여 | ✅ `lgw-default-3558c80d` |
| 서버 → PI 리버스 SSH 접속 | ✅ `ssh -p 22200 lgwadmin@localhost` |
| 두 PI(`lgw-dev`+골든) lgwadmin 통일 접속 | ✅ |
| 골든 이미지 추출 (dd \| xz pipe) | ✅ 806MB |
| 이미지 무결성 (xz -tv + sha256) | ✅ |

### 미완료 / 후속 이관 항목

| 항목 | 사유 | 후속 처리 |
|---|---|---|
| 새 SD 카드에 v20260521 복제 후 신규 PI 부팅 검증 | 운영자 현장 작업 | 별도 운영 절차 |
| 프로덕션 서버(175.206.245.234) tunnel 등록 | 현재 dev 서버(172.30.1.42) 기준 | 운영자 server-ip 배포로 전환 |
| `apply-server-ip.sh`의 systemctl restart에도 `--no-block` 일관 적용 | config-agent handler 호출이라 데드락 위험 낮음 | 후속 일관성 개선 |

---

## 3. 핵심 학습

### 잘된 점
- **PDCA 3회차 실기 검증의 가치** — gap-detector 97% 단계에서 발견 못 한 데드락이 실제 SD 복제 시 드러남
- **로깅 + 시간 정보 보존** — `first-boot-init.log`와 systemd timestamp로 hang 발생 시점/원인 즉시 추적 가능
- **모든 PI에 동일 키/사용자 통일** — ssh-proxy 코드 단순화, 게이트웨이별 분기 불필요
- **dd | xz pipe 전략** — 16GB 여유 디스크에서 30GB SD 추출 가능 (fstrim 효과 활용)

### 개선점 / 다음 사이클로
- systemd oneshot 안에서 동기 `systemctl restart` 호출 금지 패턴을 `bkit-rules`에 명시 필요
- `apply-*.sh` 5종을 한 번에 단위 테스트 가능한 mock systemctl 환경 마련
- 골든 이미지 매번 추출 후 자동 무결성/메타데이터 생성 스크립트화 (`build-golden-image.sh`)

---

## 4. 산출 파일

### 신규
- `raspberry-pi/scripts/first-boot-init.sh`
- `raspberry-pi/scripts/apply-wifi.sh`
- `raspberry-pi/scripts/apply-hostname.sh`
- `raspberry-pi/scripts/apply-gateway-id.sh`
- `raspberry-pi/scripts/apply-server-ip.sh`
- `~/Projects/golden-images/golden-lgw-v20260521.img.xz` (외부, git 미포함)
- `~/Projects/golden-images/golden-lgw-v20260521.json`
- `~/Projects/golden-images/golden-lgw-v20260521.img.xz.sha256`

### 수정
- `.env.example` — `SSH_TUNNEL_*`, `TUNNEL_SERVER_*` 동기화
- backend `config-deploy` 모듈 4종 (controller/service/types/module)
- `gateway-manager` entity (tunnel_port, machine_id, rpi_ip 컬럼)
- `frontend/src/views/ConfigDeploy.vue` 4종 카드
- `frontend/src/components/config-deploy/*` 신규
- `frontend/src/composables/useRemoteConfig.ts`

### DB
- 마이그레이션 `018_rpi_remote_config.sql`

---

## 5. PDCA 사이클 메타데이터

```yaml
feature: rpi-golden-image-system
phase: archived
matchRate: 99
iterationCount: 2
startedAt: 2026-05-17
archivedAt: 2026-05-22
archivedTo: docs/archive/2026-05/rpi-golden-image-system/
deliverables:
  - golden-lgw-v20260521.img.xz (806MB)
  - SHA-256 f2c90c15...d1208
  - 메타데이터 JSON
keyFix:
  - apply-gateway-id.sh systemctl --no-block
  - first-boot-init.sh timeout 60 안전장치
  - SSH_TUNNEL_USER=lgwadmin (PI 계정 통일)
relatedCommit: b398844
```
