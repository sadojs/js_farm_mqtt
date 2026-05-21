---
template: plan
version: 1.2
feature: rpi-golden-image-system
date: 2026-05-17
author: ohgane
project: smart-farm-mqtt
status: Draft
---

# rpi-golden-image-system Planning Document

> **Summary**: 라즈베리파이용 **재사용 가능한 골든 이미지(Golden Image)** 와 **원격 설정 배포 시스템** 을 구축한다. SD 카드 N장 빠르게 복제 → 본부에서 부팅 → 자동으로 서버에 reverse SSH 연결 → 웹 UI "설정 배포" 페이지에서 hostname / Wi-Fi SSID·비밀번호 등 원격 변경. Wi-Fi 변경 시 단순 적용 + 결과 보고 (자동 원복 없음 — 본사에서 농장 와이파이로 바꾸면 본사 인터넷 끊김이 정상이므로). 비상시 유선 LAN 기본 IP `192.168.0.100`으로 수동 복구.
>
> **Project**: smart-farm-mqtt
> **Date**: 2026-05-17
> **Status**: Draft
> **Related**:
> - Existing setup: [raspberry-pi/setup.sh](../../../raspberry-pi/setup.sh), [raspberry-pi/tunnel-setup.sh](../../../raspberry-pi/tunnel-setup.sh)
> - Production server: 175.206.245.234 (MQTT + Backend + Tunnel host)
> - 본부 Wi-Fi: KT_GiGA_5G_5E04 (골든 이미지 사전 등록)
> - 본부 라즈베리파이 #1: hostname `lgw-HK` (실기 검증용)

---

## 1. Overview

### 1.1 Purpose

현재 각 라즈베리파이마다 setup.sh 를 처음부터 실행하는 방식은:
- Pi 한 대당 10~15분 (다운로드 + 빌드 + 설치)
- 현장에서 와이파이 정보를 미리 알아야 함 (현장 작업 필수)
- 트러블슈팅 시 농장 방문 필요

**골든 이미지 + 원격 설정 배포** 로 전환하면:
- Pi 한 대당 SD 복제 ~2분 (dd)
- 본부에서 1회 부팅 → 자동 reverse SSH 연결 → 웹에서 원격 운영
- 농장 와이파이 변경, hostname 변경, 펌웨어 업데이트 모두 원격
- 양산 + 대규모 운영 가능

### 1.2 Background

- 사용자 운영 시나리오: 다농장 다게이트웨이. 매번 setup.sh 돌리는 건 비효율
- 산업 IoT 표준 패턴 (Balena, Particle, AWS Greengrass) 과 동일 아키텍처
- 무선이 끊겨도 유선 LAN으로 복구 가능해야 함 (현장 사고 대비)

### 1.3 Design Decisions (사용자 합의 사항)

| 항목 | 결정 |
|------|------|
| 첫 와이파이 | **A안 — 본부 KT_GiGA_5G_5E04 사전 등록** (가장 단순) |
| Uniqueness | 골든 이미지엔 **동일 hostname (`lgw-default`)**. 설정 배포에서 hostname/SSID/PW 입력하여 update |
| Wi-Fi 변경 롤백 | **롤백 없음** — 본사에서 농장 Wi-Fi로 변경 시 본사 Wi-Fi 인터넷 불가가 정상 시나리오. 자동 원복은 실용적이지 않음. 단순히 변경 적용 + 결과 보고만. |
| 비상 복구 | **유선 LAN 기본 IP `192.168.0.100` 사전 설정** (eth0 static) — 직접 LAN 연결로 수동 복구 (롤백 대체 안전장치) |

---

## 2. Scope

### 2.1 In Scope

#### A. 골든 이미지 빌드 시스템
- [ ] `raspberry-pi/build-golden-image.sh` — 골든 이미지 빌드 스크립트 (1회 실행, .img 산출)
- [ ] 베이스: Raspberry Pi OS Lite 64-bit (Bookworm)
- [ ] 사전 설치: Node.js 20, Zigbee2MQTT, Config Agent, GPIO Agent, autossh, NetworkManager
- [ ] 사전 설정: SSH 활성, 본부 Wi-Fi (KT_GiGA_5G_5E04) 등록, eth0 static IP 192.168.0.100
- [ ] 사전 사용자: `lgw-default` / 기본 비밀번호 (배포 시 변경 강제)
- [ ] 사전 hostname: `lgw-default`
- [ ] reverse-ssh-tunnel.service 활성 (서버 175.206.245.234 자동 연결)
- [ ] `first-boot-init.service` (oneshot) — uniqueness 없음, 단지 SSH host key 재생성 + tunnel key 등록

#### B. SD 카드 복제 도구
- [ ] `raspberry-pi/clone-sd.sh` — 골든 이미지를 SD 카드에 dd 복제 (디스크 안전 확인 포함)

#### C. 백엔드 — 원격 설정 배포 API 확장 (`config-deploy` 모듈)
- [ ] `POST /api/config-deploy/:gatewayId/hostname` — hostname 변경
- [ ] `POST /api/config-deploy/:gatewayId/wifi` — Wi-Fi 변경 (SSID/Password)
- [ ] `POST /api/config-deploy/:gatewayId/gateway-id` — gateway-id 갱신 (DB + Pi 양쪽)
- [ ] **`POST /api/config-deploy/:gatewayId/server-ip` — MQTT 서버 IP + reverse tunnel 서버 IP 동시 변경** (예: 172.30.1.42 → 175.206.245.234)
- [ ] MQTT publish: `farm/{gw}/config/{wifi,hostname,gateway-id,server-ip}-update`
- [ ] 설정 결과 수신: `farm/{gatewayId}/config/response` 구독
- [ ] 활동 로그 기록: `gateway.config.{wifi,hostname,gatewayid,serverip}.{applied,applied_no_internet,failed}`

#### D. 라즈베리파이 — config-agent 확장
- [ ] `config-agent/index.js`에 MQTT 명령 핸들러 추가:
  - `config/wifi-update` → `apply-wifi.sh <ssid> <password>` 호출
  - `config/hostname-update` → `hostnamectl set-hostname` + reboot 예약
  - `config/gateway-id-update` → `/etc/smartfarm/gateway-id` 갱신 + 서비스 재시작
  - **`config/server-ip-update` → `apply-server-ip.sh <new-ip>` 호출**:
    1. `/etc/smartfarm/server-ip` 갱신
    2. `/etc/systemd/system/reverse-ssh-tunnel.service` 의 SERVER_HOST 치환
    3. Z2M config(`/opt/zigbee2mqtt/data/configuration.yaml`) mqtt.server 치환
    4. gpio-agent.env MQTT_SERVER 치환
    5. config-agent.env MQTT_SERVER 치환
    6. 모든 영향 서비스 재시작 (zigbee2mqtt, config-agent, gpio-agent, reverse-ssh-tunnel)
- [ ] `raspberry-pi/scripts/apply-wifi.sh` (단순 변경 + 결과 보고):
  - 새 NM connection 추가 + 활성
  - 60초 내 인터넷 확인 (`ping 8.8.8.8 -c 3 -W 5`) → 결과 1회만 MQTT 보고
  - **롤백 없음** — 변경은 그대로 유지. 사용자가 농장 발송 의도로 변경한 것으로 가정
  - 인터넷 실패 시에도 새 Wi-Fi 설정 그대로 두고 status='applied_no_internet' 보고 (사용자에게 정보 제공만)

#### E. 프론트엔드 — 설정 배포 페이지에 Wi-Fi/Hostname 변경 UI
- [ ] `ConfigDeploy.vue`에 게이트웨이별 카드 확장:
  - 현재 hostname / Wi-Fi SSID 표시
  - 변경 폼: 새 hostname / 새 Wi-Fi SSID / 새 Wi-Fi PW
  - "적용" 버튼 — 변경 시도 시 진행 상태 표시 (시도 중 / 성공 / 롤백됨)
  - 안내 배너: "본사에서 농장 Wi-Fi로 변경 시 본사 인터넷 끊김 정상 / 비상시 LAN 직결 192.168.0.100"
  - WebSocket으로 결과 수신 → 실시간 반영

#### F. 비상 복구 가이드
- [ ] `raspberry-pi/RECOVERY.md` — 무선 접속 불가 시 유선 LAN(`192.168.0.100`) 으로 수동 복구하는 방법

### 2.2 Out of Scope

- Pi가 인터넷 못 잡았을 때 Pi 스스로 핫스팟 띄우는 Soft AP 모드 (옵션 B) — 후속 사이클
- 셀룰러 4G 백업 회선 — 후속 사이클
- 자동 펌웨어 OTA 업데이트 — 후속 사이클 (현재는 git pull + setup.sh 수동)
- 골든 이미지 안에 본부 Wi-Fi 비밀번호 평문 저장 → 보안 강화 (TPM/HSM 등) — 후속

---

## 3. Requirements

### 3.1 Functional Requirements

#### A. 골든 이미지 빌드

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-A1 | `build-golden-image.sh` 실행 시 Pi OS Lite 64-bit 다운로드 + 마운트 + 커스터마이즈 + 압축 .img 산출 | High |
| FR-A2 | 골든 이미지에 Node 20, Z2M, Config Agent, GPIO Agent, autossh, NetworkManager 사전 설치 | High |
| FR-A3 | 골든 이미지의 NM 프로파일에 본부 Wi-Fi (KT_GiGA_5G_5E04) 사전 등록 | High |
| FR-A4 | 골든 이미지의 eth0 NM 프로파일에 static IP `192.168.0.100/24` 사전 설정 (gw=192.168.0.1, dns=8.8.8.8) | High |
| FR-A5 | hostname=`lgw-default`, 사용자=`lgw-default`/Admin123! 사전 설정 | High |
| FR-A6 | `reverse-ssh-tunnel.service` 활성 + autossh 사전 등록 | High |
| FR-A7 | `first-boot-init.service` (oneshot): SSH host key 재생성 + tunnel용 SSH key 새로 만들고 서버에 등록 | High |
| FR-A8 | 본부 운영자 노트북에서 dd로 SD 카드 복제하면 ~ 2분 안에 복제 완료 | Medium |

#### B. 원격 설정 배포 — 백엔드

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-B1 | `POST /api/config-deploy/:gatewayId/wifi` — body: `{ssid, password}` → MQTT publish | High |
| FR-B2 | `POST /api/config-deploy/:gatewayId/hostname` — body: `{hostname}` → MQTT publish | High |
| FR-B3 | `POST /api/config-deploy/:gatewayId/gateway-id` — body: `{newGatewayId}` → MQTT publish (DB도 함께 갱신) | Medium |
| FR-B4 | `farm/{gw}/config/response` 구독 → DB 상태 + WebSocket 브로드캐스트 | High |
| FR-B5 | 활동 로그 기록: `gateway.config.{wifi,hostname,gatewayid}.{success,rolled_back,failed}` | Medium |

#### C. 원격 설정 배포 — Pi 측 config-agent

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-C1 | `farm/{gw}/config/wifi-update` 수신 시 `network-watchdog.sh apply-wifi <ssid> <pw>` 호출 | High |
| FR-C2 | `farm/{gw}/config/hostname-update` 수신 시 `hostnamectl set-hostname` + `/etc/hosts` 갱신 + 재부팅 예약 | Medium |
| FR-C3 | `farm/{gw}/config/gateway-id-update` 수신 시 `/etc/smartfarm/gateway-id` 갱신 + 영향 서비스 재시작 (config-agent, gpio-agent, Z2M base_topic) | Medium |
| FR-C4 | 결과를 `farm/{gw}/config/response` 로 publish (status: success/rolled_back/failed, detail) | High |

#### D. apply-wifi.sh (단순 변경 + 결과 보고)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-D1 | `apply-wifi.sh <ssid> <pw>` — 새 NM connection 추가 + 활성 (`nmcli connection add type wifi ssid ... psk ...`) | High |
| FR-D2 | 60초 동안 `ping 8.8.8.8 -c 3 -W 5` 로 인터넷 확인 | High |
| FR-D3 | 결과 MQTT `farm/{gw}/config/response` 로 보고:<br>· `applied_online` — 새 Wi-Fi + 인터넷 OK<br>· `applied_no_internet` — 새 Wi-Fi 활성됐으나 인터넷 안 됨 (본사 → 농장 발송 시 정상) | High |
| FR-D4 | **롤백 없음** — 변경은 그대로 유지. 비상시 사용자가 LAN 직결 `192.168.0.100`으로 복구 | High |
| FR-D5 | 시도 로그를 `/var/log/apply-wifi.log` 에 기록 | Low |

#### E. 프론트엔드

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-E1 | `ConfigDeploy.vue` 게이트웨이 카드에 hostname / Wi-Fi SSID 현재값 표시 | High |
| FR-E2 | 변경 폼: 새 hostname / 새 SSID / 새 PW 입력 + 적용 버튼 | High |
| FR-E3 | 변경 진행 상태 표시 (대기 → 적용중 → applied_online / applied_no_internet) — WebSocket 실시간 | High |
| FR-E4 | 변경 시 안내 배너: "본사 Wi-Fi와 다른 농장 Wi-Fi로 변경 시 본사에선 인터넷 끊김이 정상입니다. Pi를 농장에 설치하면 자동 연결됩니다. 비상시 LAN 케이블 직결 → 192.168.0.100 접근." | High |
| FR-E5 | 변경 후 reverse tunnel 끊김 — 다음 부팅까지 오프라인 표시. 농장에서 새 Wi-Fi로 연결 시 자동 tunnel 복구 → "연결 복구" 알림 | Medium |

#### F. 비상 복구

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-F1 | 골든 이미지 eth0 default static IP `192.168.0.100/24` 사전 설정 | High |
| FR-F2 | 노트북에서 LAN 케이블 직결 시 `ssh lgw-default@192.168.0.100` 으로 접근 가능 | High |
| FR-F3 | `RECOVERY.md` 문서: LAN 케이블 직결 → 수동 nmcli 명령 가이드 | Medium |

### 3.2 Non-Functional Requirements

| Category | Criteria |
|----------|----------|
| 빌드 시간 | 골든 이미지 빌드 1회 ~ 30분 / SD 복제 ~ 2분 |
| 원격 명령 응답 | MQTT publish → Pi 실행 → 결과 응답까지 평균 ≤ 60초 |
| Wi-Fi 변경 시간 | 새 connection 추가 + 활성 + 60초 인터넷 확인 = ~ 90초 |
| 보안 | MQTT 자격증명 / Wi-Fi 비밀번호는 `/etc/smartfarm/*.env` 권한 600 |
| 안전성 | Wi-Fi 변경 실패 → 반드시 이전 설정으로 자동 복귀 (사용자가 농장 방문 안 해도 됨) |
| 확장성 | 골든 이미지로 N대 양산 가능, 각 Pi는 첫 부팅 시 unique tunnel key 자동 생성 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] `build-golden-image.sh` 실행 → `golden-lgw-vX.img` 생성 (~ 3GB 압축)
- [ ] SD 카드 dd 복제 → 본부에서 부팅 → 약 1~2분 내 reverse tunnel 연결 확인 (웹UI에서 보임)
- [ ] 웹UI "설정 배포" 페이지에서 hostname 변경 → 1분 내 적용 확인
- [ ] Wi-Fi 변경 → **성공 시나리오**: 새 와이파이로 정상 동작 (applied_online)
- [ ] Wi-Fi 변경 → **인터넷 없음 시나리오** (본사 → 농장 SSID): applied_no_internet 알림 + 변경 유지
- [ ] 무선 끊긴 상태에서 LAN 케이블 직결 → `192.168.0.100` 으로 SSH 접속 확인
- [ ] `RECOVERY.md` 문서 작성

### 4.2 Quality Criteria

- [ ] 백엔드 + 프론트 TypeScript 검증 통과
- [ ] 모든 Pi 측 bash 스크립트 `bash -n` 통과
- [ ] 단위 시나리오 5종 통과 (성공/롤백/하이브리드/대형 변경 동시/네트워크 끊김)

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 골든 이미지 안의 본부 Wi-Fi 비밀번호 평문 노출 | Medium (사내) | High | 권한 600 + 향후 사이클에서 암호화 |
| 모든 Pi가 동일 hostname `lgw-default`로 부팅 시 mDNS 충돌 | Medium | High | 본부에서 1대씩 부팅 + 즉시 hostname 변경 운영 절차 정착 |
| 동일 SSH host key로 인한 보안 약화 | Medium | High | `first-boot-init.service`가 첫 부팅 시 host key 재생성 (FR-A7) |
| Wi-Fi 변경 후 reverse tunnel 끊김 → 결과 응답 못 받음 | High | Medium | MQTT는 새 Wi-Fi로 자동 재연결 후 publish (tunnel과 독립) |
| 새 Wi-Fi 도메인은 DHCP가 IP 주지만 인터넷 라우팅 안되는 케이스 | Medium | Low | `ping 8.8.8.8`로 실제 인터넷 확인 (단순 link-up 만 안 됨) |
| 사용자가 잘못된 hostname 으로 변경 → 충돌 | Low | Medium | 백엔드에서 hostname 정규식 검증 + 중복 확인 |
| 골든 이미지 빌드 시 macOS 호스트에서 Linux 파일시스템 마운트 어려움 | High | High | Linux VM (UTM/Docker) 안에서 빌드 OR `pi-gen` 도구 사용 |
| 동일한 tunnel SSH key로 첫 부팅 시 서버 authorized_keys 충돌 | Medium | High | `first-boot-init`가 새 키 생성 → 백엔드에 등록 (기존 tunnel-setup.sh 로직 재활용) |

---

## 6. Architecture

### 6.1 골든 이미지 빌드 환경

골든 이미지는 macOS에서 직접 만들기 어려움 (ext4 마운트 제약). 두 가지 옵션:

- **옵션 1**: Linux VM (UTM, Lima, Docker on macOS) 안에서 빌드
- **옵션 2**: pi-gen (라즈베리파이 공식 도구) — Docker로 실행 가능
- **옵션 3**: 본부 라즈베리파이 1대 안에서 직접 빌드 후 dd로 추출 (가장 단순)

→ **옵션 3 권장** (lgw-HK 1대를 "마스터 Pi"로 만들고 그 SD 카드를 ddrescue로 추출)

### 6.2 시스템 구성도

```
┌──────────────────────────────────────────────────────────┐
│ 본부 / 사무실                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Master Pi (lgw-HK)                                 │  │
│  │  ─ OS Lite 64-bit, Z2M, Config Agent, GPIO Agent  │  │
│  │  ─ NM: KT_GiGA_5G_5E04 + eth0 static 192.168.0.100│  │
│  │  ─ user: lgw-default / Admin123!                  │  │
│  │  ─ reverse-ssh-tunnel.service 활성                │  │
│  │  ─ first-boot-init.service (oneshot)              │  │
│  └────────────────────────────────────────────────────┘  │
│         │                                                │
│         ▼ ddrescue → golden-lgw-vX.img.xz                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ build-golden-image.sh / clone-sd.sh                │  │
│  └────────────────────────────────────────────────────┘  │
│         │ dd                                             │
│         ▼ SD 카드 N장                                     │
└──────────────────────────────────────────────────────────┘
          │ (운영자가 본부에서 Pi에 SD 꽂고 부팅)
          ▼
┌──────────────────────────────────────────────────────────┐
│ 본부 부팅 (1회) — 본부 Wi-Fi 자동 연결                      │
│  Pi → 인터넷 → 서버 175.206.245.234 reverse SSH tunnel    │
│  웹UI 게이트웨이 관리 페이지에 "lgw-default" 로 나타남     │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│ 웹UI "설정 배포" 페이지에서:                                │
│  1. hostname 변경: lgw-default → lgw-farmXX               │
│  2. Wi-Fi 변경: KT_GiGA → 농장 Wi-Fi                      │
│  3. (선택) gateway-id 변경                                │
│  ───────────────────────────────────────────             │
│  각 변경 → MQTT publish → Pi config-agent 수신            │
│         → network-watchdog.sh (Wi-Fi인 경우)              │
│         → 새 connection 적용 → 60초 ping 확인             │
│         → applied_online / applied_no_internet 보고       │
│         → MQTT response publish → 웹UI 실시간 반영        │
└──────────────────────────────────────────────────────────┘
          │
          ▼ (농장 발송)
┌──────────────────────────────────────────────────────────┐
│ 농장에서 Pi 전원 ON                                        │
│  → 변경된 농장 Wi-Fi 자동 연결                             │
│  → MQTT/tunnel 자동 복구                                  │
│  → 웹UI에서 정상 운영                                      │
└──────────────────────────────────────────────────────────┘
```

### 6.3 비상 복구 시나리오

```
사용자가 잘못된 Wi-Fi 변경 → 3회 실패 → 롤백 → 이전 Wi-Fi 복귀
    ↓ (그래도 안 됨 — Pi가 농장 와이파이로 완전 단절)
운영자가 농장 방문 → 노트북 LAN 케이블 직결 → 192.168.0.100 SSH
    ↓ 수동 복구: nmcli connection modify ... + nmcli connection up ...
```

### 6.4 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 골든 이미지 빌드 환경 | Docker pi-gen / Linux VM / 마스터 Pi 직접 | **마스터 Pi 직접 (옵션 3)** | 가장 단순, 디버깅 쉬움 |
| Wi-Fi 관리자 | wpa_supplicant / NetworkManager | **NetworkManager (Bookworm 기본)** | 백업/복원/연결 전환 nmcli로 표준화 |
| 원격 명령 채널 | SSH tunnel / MQTT | **MQTT (config-agent 활용)** | Wi-Fi 변경 시 tunnel 잠시 끊겨도 MQTT는 새 Wi-Fi로 재연결 |
| 롤백 트리거 | systemd timer / 인라인 sleep | **인라인 sleep + ping** | 단순, 명령 응답성 좋음 |
| 결과 보고 | HTTP callback / MQTT response | **MQTT response 토픽** | 양방향 비동기 표준 |

---

## 7. Implementation Order

1. **[1h] 마스터 Pi 설정 안정화**: 본부에서 lgw-HK 1대를 setup.sh로 정상 동작시킴 (이번 작업과 별개로 진행 중)
2. **[3h] 골든 이미지 빌드 스크립트** (`build-golden-image.sh`):
   - 마스터 Pi 종료 → SD 카드 추출 → macOS에서 ddrescue → 압축
   - first-boot-init.service 작성 (SSH host key + tunnel key 재생성)
   - NM 프로파일 (본부 Wi-Fi + eth0 static)
3. **[1h] SD 복제 스크립트** (`clone-sd.sh`):
   - 디스크 안전 확인 (USB external 만)
   - dd progress + 검증
4. **[4h] network-watchdog.sh**:
   - apply-wifi / rollback / report 로직
   - 단위 테스트 (가짜 SSID로 롤백 검증)
5. **[2h] config-agent 확장**:
   - MQTT 토픽 핸들러 추가 (wifi-update, hostname-update, gateway-id-update)
   - network-watchdog 호출 + MQTT response publish
6. **[2h] 백엔드 config-deploy 모듈 확장**:
   - POST 엔드포인트 3종 + MQTT publish + response 구독
   - 활동 로그 기록
7. **[2h] 프론트엔드 ConfigDeploy.vue 확장**:
   - 게이트웨이 카드에 hostname / Wi-Fi 폼
   - WebSocket 실시간 결과 반영
8. **[1h] RECOVERY.md** 작성
9. **[2h] 통합 테스트 5종**:
   - 성공 시나리오 (정상 Wi-Fi)
   - 롤백 시나리오 (가짜 Wi-Fi)
   - 하이브리드 (Wi-Fi + hostname 동시)
   - 다중 변경 직렬화
   - 비상 LAN 복구

**총 예상**: 약 18시간 (~ 2.5일 풀타임)

---

## 8. Test Plan

### 8.1 단위 시나리오 (Pi 1대 + 백엔드)

| ID | 시나리오 | 기대 결과 |
|----|----------|-----------|
| TS-01 | 골든 이미지 dd → 부팅 | 본부 Wi-Fi 자동 연결, reverse tunnel 활성, 웹UI에 "lgw-default" 표시 |
| TS-02 | 웹UI 에서 hostname 변경 | `lgw-default` → `lgw-test01` 변경 + 재부팅 + 새 hostname으로 재연결 |
| TS-03 | 웹UI 에서 Wi-Fi 변경 (정상 SSID) | 새 Wi-Fi 활성 + 인터넷 확인 + success 응답 |
| TS-04 | 웹UI 에서 Wi-Fi 변경 (본사 → 농장 SSID) | 새 connection 활성 + 인터넷 안 됨 → applied_no_internet 응답 / 변경은 유지 (Pi를 농장으로 옮기면 자동 연결) |
| TS-05 | Wi-Fi 변경 직후 reverse tunnel 끊김 → 재연결 | 1~2분 내 tunnel 자동 복구 |
| TS-06 | LAN 케이블 직결 → 192.168.0.100 SSH | 무선 끊긴 상태에서도 접근 가능 |
| TS-07 | gateway-id 변경 | DB + Pi 양쪽 갱신, Z2M base_topic 변경 + 재시작 |

### 8.2 회귀 (기존 기능)

- 자동제어 룰 동작 (Zigbee/GPIO 모두)
- 우적 센서 → 개폐기 자동 닫음
- WebSocket 게이트웨이 상태 업데이트

---

## 9. Out of Scope (재확인)

- Pi 스스로 핫스팟 (Soft AP) — 별도 사이클
- 셀룰러 4G 백업
- 자동 펌웨어 OTA
- 골든 이미지 비밀번호 암호화 (TPM/HSM)
- 마스터 Pi → 골든 이미지 변환 자동화 (현재는 ddrescue 수동)

---

## 10. Next Steps

1. [ ] 본부 라즈베리파이 #1 (lgw-HK) setup.sh 로 정상 동작 검증 (별도 작업)
2. [ ] `/pdca design rpi-golden-image-system` 으로 상세 설계 (선택)
3. [ ] `/pdca do rpi-golden-image-system` 으로 위 §7 구현 순서 진행

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-17 | 사용자 합의 사항 3건 반영: (1) A안=본부 Wi-Fi (2) 동일 hostname + 설정배포로 갱신 (3) 3회 시도 후 롤백 + 유선 LAN 비상 복구 | ohgane |
| 0.2 | 2026-05-17 | Wi-Fi 롤백 기능 제거 — 본사에서 농장 Wi-Fi 변경 시 본사 인터넷 끊김이 정상이므로 자동 원복이 실용적이지 않음. 단순 변경 + 결과 보고 + 비상시 유선 LAN으로 복구 방식으로 단순화 | ohgane |
| 0.3 | 2026-05-17 | 서버 IP 원격 변경 기능 추가 (개발→프로덕션 전환용): FR-C 의 server-ip-update 명령 + apply-server-ip.sh — Z2M/agent/tunnel 모두 동일 IP로 동시 갱신. 골든 이미지에 reverse tunnel 설정 포함 명시. | ohgane |
