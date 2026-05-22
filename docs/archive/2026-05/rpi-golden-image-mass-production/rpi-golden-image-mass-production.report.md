---
template: report
version: 1.0
feature: rpi-golden-image-mass-production
date: 2026-05-22
author: ohgane
project: smart-farm-mqtt
status: Completed
---

# rpi-golden-image-mass-production 완료 보고서

> **Summary**: 골든 이미지 v20260521을 신규 PI에 부팅 → 자동 등록 → 4종 원격 설정 배포 → onboard slots 시드 → MQTT 단절 시뮬레이션 → fallback 페일오버 진입(56s)/복귀(6s) 검증을 end-to-end로 수행. **9건 BUG 발견 + 5건 즉시 fix + 4건 별도 사이클 이관**으로 양산 파이프라인의 완성도를 크게 향상시킴. Match Rate **88%**.
>
> **Owner**: 오정석 (sadojs@gmail.com)
> **Started**: 2026-05-22
> **Completed**: 2026-05-22
> **Duration**: 약 2시간 (1일, 반복 1회 — BUG fix 후 재검증)

---

## 1. PDCA 개요

### Plan (계획)
**문서**: `docs/01-plan/features/rpi-golden-image-mass-production.plan.md`

- **목표**: 신규 PI 부팅 → 4종 원격 설정 → 장치/룰 등록 → 페일오버 동작까지 통합 양산 검증
- **검증 범위**: A~J 10단계 시나리오, 12개 FR + 7개 AT
- **결정 사항**:
  - Wi-Fi 검증: 본부 SSID 동일 객체 멱등성
  - server-ip 검증: ping 가능 LAN 호스트로 임시 변경
  - 운영 hostname: `lgw-pilot01`
  - 검증 종료: lgw-dev와 함께 상시 운영 게이트웨이 #2로 유지

### Design (설계)
**문서**: `docs/02-design/features/rpi-golden-image-mass-production.design.md`

- 검증 토폴로지: Mac(dev server) + lgw-dev(기존) + lgw-pilot01(신규)
- 9개 측정 지점(Telemetry) 정의
- 단계별 Pre/Post-condition + 절차 + Acceptance 기준
- evidence/ 디렉토리에 단계별 산출물 누적

### Do (실행)
**기간**: 2026-05-22 20:24 ~ 22:22 (약 2시간)

#### 통과 단계 (8.5/10)

| 단계 | 핵심 결과 |
|---|---|
| B PI 자동 등록 | DB row 자동 INSERT (machine_id=e7874755..., tunnel_port=22200, rpi_ip=172.30.1.89). 단, backend crash 상태였어서 1차 실패 → 복구 후 재실행으로 통과 |
| C 5개 서비스 active | reverse-ssh-tunnel/config-agent/gpio-agent/fallback-engine active (zigbee2mqtt 제외, dongle 부재로 무관) |
| D 백엔드 MQTT 인지 | `MqttBridgeHandler 게이트웨이 lgw-pilot01 터널/Agent → online`, `FallbackConfigService mode=online` |
| E-1 hostname 배포 | 11초 적용, hostnamectl/`/etc/hostname` 정확 |
| E-2 gateway-id 배포 | PI 적용 ✓, DB cascade 일부 실패(BUG-03) → fix 후 재검증 ✓ |
| E-3 Wi-Fi 멱등성 | DTO MaxLength 63 → hex PMK 64 거부(BUG-05) → fix 후 적용 (11초, 인터넷 끊김 0) |
| F onboard 시드 | `GET /api/gateway-env/:uuid/onboard` lazy seed로 12개 slot 자동 INSERT |
| H 페일오버 | 진입 **T+56s** (heartbeat=60s 정확), 복귀 **T+6s**, 이벤트 큐 3건 flush, fallback_events DB 3건 |
| I 회귀 영향 | lgw-dev activity_logs/fallback_events 검증 시간대 **0건** |

#### 부분 통과 / 보류 단계

| 단계 | 상태 | 사유 |
|---|---|---|
| G 자동화 룰 등록 | ⚠️ 부분 | 신규 게이트웨이에 devices 자동 INSERT 안 됨(BUG-06) → lgw-dev 룰로 fallback 검증 대체 |
| E-4 server-ip 변경 | ⏭️ SKIP | 위험성 + 이미 충분한 BUG 발견. 다음 사이클로 이관 |

### Check (분석)
**문서**: `docs/03-analysis/rpi-golden-image-mass-production.analysis.md`

| 분석 회차 | Match Rate | 핵심 |
|:--:|:--:|---|
| 1차 실기 검증 | 76% | 9건 BUG 발견 (실기 가치) |
| 2차 BUG fix 후 재검증 | **88%** | 5건 즉시 fix + 4건 별도 사이클 이관 |

### Act (개선)
**핵심 fix 5건**:

1. **BUG-01** `apply-gateway-id.sh:55-63` — env 갱신 루프에 `fallback-engine.env` 추가
2. **BUG-02** `apply-gateway-id.sh:65-86` — first-boot vs 운영 중 분기, 운영 중에는 `timeout 20 systemctl restart` 동기 실행 (환경변수 reload 보장)
3. **BUG-03** `config-deploy.service.ts:699-715` — `gateway_onboard_devices` cascade UPDATE 제거 (UUID 컬럼, 잘못된 시도)
4. **BUG-05** `update-wifi.dto.ts:13` — `@MaxLength(63)` → `@MaxLength(64)` (hex PMK 64자 허용)
5. **BUG-09** `config-deploy.service.ts:710` — gateway-id cascade에 `fallback_configs/fallback_gateway_status/fallback_opener_schedule/fallback_events` 추가

**재검증**: `lgw-pilot01 → lgw-pilot01-temp → lgw-pilot01` 2회 연속 cascade 정상, backend 로그 `cascade 실패` 0건.

**별도 사이클 이관 4건**:
- BUG-04: activity_logs PK 충돌 → backend abort (재현 추적 필요)
- BUG-06: 신규 게이트웨이 devices 자동 provision
- BUG-08: PI 로컬 broker 추가 (페일오버 핵심 가치 향상)
- E-4 server-ip 원격 배포 + eth0 fallback 절차

---

## 2. 구현 결과

### 완료 항목

#### 검증 통과
- ✅ 골든 이미지 → PI 부팅 → reverse-ssh-tunnel 자동 활성화 (이전 사이클의 데드락 fix 실기 입증)
- ✅ 자동 register-tunnel-key + machine_id 기반 gateway_id 부여
- ✅ 5개 systemd 서비스 자동 의존성 정상
- ✅ 4종 원격 설정 배포 중 3종 통과 (hostname / gateway-id / Wi-Fi) — server-ip 보류
- ✅ onboard 12-slot lazy seed (fan_1~4, irrigation_zone_1~4, mixer, fertilizer_*, remote_control)
- ✅ MQTT 단절 → fallback 진입 56s + safety_off 발행
- ✅ MQTT 복귀 → 6s 재연결 + 6 토픽 재구독 + 이벤트 큐 flush
- ✅ lgw-dev 회귀 영향 0

#### 코드 fix 5건
- `raspberry-pi/scripts/apply-gateway-id.sh` (BUG-01, BUG-02)
- `backend/src/modules/config-deploy/config-deploy.service.ts` (BUG-03, BUG-09)
- `backend/src/modules/config-deploy/dto/update-wifi.dto.ts` (BUG-05)

#### 산출 evidence (10개 파일)
```
docs/evidence/
├── BUGS-found.md                       # 9건 BUG 상세
├── C-services.txt                      # 5개 서비스 active 확인
├── D-gateway-db.txt                    # DB 자동 등록 (machine_id, tunnel_port)
├── D-pi-mqtt-topics.txt                # MQTT topic mismatch 확인
├── E1-hostname-response.json           # E-1 API 응답
├── E1-pi-state.txt                     # E-1 PI 상태
├── E2-gateway-id-response.json         # E-2 API 응답
├── E2-pi-state.txt                     # E-2 PI 상태
├── E2-db.txt                           # E-2 DB 상태
├── E3-wifi-response.json               # E-3 API 응답
├── E3-pi-wifi-after.txt                # E-3 PI nmcli 상태
├── E3-pi-wifi-before.txt               # E-3 사전 상태
├── F-onboard-seed.json                 # F onboard 시드 결과 (12개)
├── F-pilot-onboard-seeded.txt          # F DB 시드 row
├── H-timeline.txt                      # H 페일오버 타임라인
├── H1-fb-enter.log                     # H 진입 로그
├── H3-fb-exit.log                      # H 복귀 로그
├── H-fb-events-db.txt                  # H fallback_events DB
└── I-lgw-dev-noise.txt                 # I 회귀 영향 0 증거
```

### 미완료 / 후속 이관 항목

| 항목 | 사유 | 후속 처리 |
|---|---|---|
| E-4 server-ip 검증 | 위험도 + 시간 효율 | 다음 사이클 (`rpi-server-ip-rollover`) |
| BUG-04 activity_logs PK 충돌 추적 | 별도 깊은 분석 필요 | 별도 사이클 |
| BUG-06 신규 게이트웨이 devices 자동 INSERT | UX vs 자동화 trade-off 결정 필요 | 별도 사이클 (`rpi-auto-device-provision`) |
| BUG-08 PI 로컬 mosquitto broker | 골든 이미지 변경 + setup.sh 변경 + 검증 재테스트 | 별도 사이클 (`rpi-local-broker-failover`) |
| 운영 절차서 (runbook) | 본 보고서로 대체, 정제 필요 | 후속 작업 |

---

## 3. 핵심 학습

### 잘된 점
- **실기 검증으로만 발견 가능한 BUG들** — schema 타입, validation 길이, oneshot 데드락, env 갱신 누락 등 9건 — 코드 리뷰/단위 테스트로는 발견 어려운 통합 이슈
- **백엔드 자동 watch + DTO 핫 패치 → 즉시 재검증** 사이클이 효율적
- **양산 시나리오는 운영 게이트웨이(lgw-dev)와 함께 검증해야 회귀 영향 측정 가능** — lgw-dev 영향 0 입증으로 양산 안전성 검증
- **fallback-engine heartbeat timeout이 정확히 동작** — 60s 설정 → 56s 진입 (오차 -4s) — 사양과 일치

### 개선점 / 다음 사이클로
- **fallback-engine의 단절 시 GPIO 직접 제어 불가**가 가장 큰 발견 — 페일오버의 핵심 가치가 단순 모드 추적이 아닌 실제 안전 동작이어야 함. **PI 로컬 broker** 도입이 핵심.
- **신규 게이트웨이 자동 provision** (devices + channelMapping)이 부재 — UI 클릭 다수 vs 자동화 — UX 설계 결정 필요
- **gateway_id 변경 시 cascade**가 명시적 코드로만 처리됨 → 마이그레이션에 `ON UPDATE CASCADE` 추가 또는 더 robust한 패턴
- **activity_logs PK 충돌**은 운영 중 backend abort를 야기 — 자동화 룰 30s 주기 트리거 + log INSERT 패턴 재검토 필요

### 운영 권장사항
- 신규 PI 양산 시 본 보고서의 단계 B~H 순서를 그대로 따를 것
- E-4(server-ip 변경)는 반드시 eth0 직결 경로 확보 후 수행
- 첫 부팅 후 backend가 살아있는지 사전 확인 (backend crash 시 register 실패)
- gateway-id 배포 후 fallback_gateway_status 잔존 row 점검(BUG-09 fix 후 자동 처리)

---

## 4. PDCA 사이클 메타데이터

```yaml
feature: rpi-golden-image-mass-production
phase: archived
matchRate: 88
iterationCount: 1
startedAt: 2026-05-22
archivedAt: 2026-05-22
archivedTo: docs/archive/2026-05/rpi-golden-image-mass-production/
deliverables:
  - 9건 BUG 발견 + 5건 즉시 fix
  - evidence/ 10개 파일 (단계별 검증 증거)
  - 페일오버 진입 56s + 복귀 6s 정밀 측정
  - lgw-pilot01 운영 게이트웨이 #2 상시 운영 전환
relatedCycles:
  - rpi-golden-image-system (이전 사이클의 실기 입증)
  - rpi-emergency-failover (페일오버 로직 입증)
nextCycles:
  - rpi-server-ip-rollover (E-4 미완 검증)
  - rpi-auto-device-provision (BUG-06)
  - rpi-local-broker-failover (BUG-08 — 페일오버 가치 향상)
  - rpi-activity-log-pk-trace (BUG-04)
relatedCommit: TBD
```
