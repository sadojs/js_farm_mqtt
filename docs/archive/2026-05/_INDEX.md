# Archive Index — 2026-05

본 디렉토리는 2026년 5월 완료된 PDCA 사이클을 보관합니다.

## Features

| Feature | Archived At | Match Rate | Cycle | Docs |
|---------|-------------|-----------:|------:|------|
| [rain-sensor-opener-override](./rain-sensor-opener-override/) | 2026-05-15 | 100% | 1 | plan, report |
| [opener-actuator-label-i18n](./opener-actuator-label-i18n/) | 2026-05-15 | 100% | 1 | plan, design, analysis, report |
| [rpi-emergency-failover](./rpi-emergency-failover/) | 2026-05-21 | 98% | 1 | plan, design, analysis, report |
| [rpi-fallback-channel-sync](./rpi-fallback-channel-sync/) | 2026-05-21 | 96% | 1 | plan, design, analysis, report |
| [rpi-golden-image-system](./rpi-golden-image-system/) | 2026-05-22 | 99% | 2 | plan, design, analysis, report |
| [rpi-golden-image-mass-production](./rpi-golden-image-mass-production/) | 2026-05-22 | 88% | 1 | plan, design, analysis, report |
| [rpi-hostname-gateway-id-unify](./rpi-hostname-gateway-id-unify/) | 2026-05-23 | 96% | 1 | plan, design, analysis, report |

## Quick Links

### rain-sensor-opener-override
- [plan](./rain-sensor-opener-override/rain-sensor-opener-override.plan.md)
- [report](./rain-sensor-opener-override/rain-sensor-opener-override.report.md)

### opener-actuator-label-i18n
- [plan](./opener-actuator-label-i18n/opener-actuator-label-i18n.plan.md)
- [design](./opener-actuator-label-i18n/opener-actuator-label-i18n.design.md)
- [analysis](./opener-actuator-label-i18n/opener-actuator-label-i18n.analysis.md)
- [report](./opener-actuator-label-i18n/opener-actuator-label-i18n.report.md)

### rpi-emergency-failover (서버↔RPi 단절 시 안전 동작)
- [plan](./rpi-emergency-failover/rpi-emergency-failover.plan.md)
- [design](./rpi-emergency-failover/rpi-emergency-failover.design.md)
- [analysis](./rpi-emergency-failover/rpi-emergency-failover.analysis.md)
- [report](./rpi-emergency-failover/rpi-emergency-failover.report.md)

### rpi-fallback-channel-sync (위 사이클의 후속 — 채널-핀 매핑 동기화)
- [plan](./rpi-fallback-channel-sync/rpi-fallback-channel-sync.plan.md)
- [design](./rpi-fallback-channel-sync/rpi-fallback-channel-sync.design.md)
- [analysis](./rpi-fallback-channel-sync/rpi-fallback-channel-sync.analysis.md)
- [report](./rpi-fallback-channel-sync/rpi-fallback-channel-sync.report.md)

## 통합 사이클: 라즈베리파이 이머전시 페일오버 (2026-05-20 ~ 2026-05-21)

`rpi-emergency-failover` (98%) + `rpi-fallback-channel-sync` (96%) 두 사이클로 완성:

- **선행 사이클**: 폴백 인프라 (DB 4 테이블, MQTT 토픽 6종, fallback-engine 9 모듈, UI 페이지) + 안전 정책 12종 구현
- **후속 사이클**: 선행 사이클의 Known Limitation 해결 — gpio-agent 호환 채널-핀 매핑 동기화. EventEmitter 기반 자동 sync.
- **결과**: 서버 단절 시 RPi가 자율적으로 작물 안전 동작 (관수 30분 OFF, 액비 즉시 OFF, 환기팬 35/28°C 히스테리시스, 개폐기 월별 스케줄, 빗물 강제 CLOSE)
- **다음 단계**: 골든 이미지 재빌드 + 농장 출하 테스트

### rpi-golden-image-system (재사용 가능한 골든 이미지 + 원격 설정 배포)
- [plan](./rpi-golden-image-system/rpi-golden-image-system.plan.md)
- [design](./rpi-golden-image-system/rpi-golden-image-system.design.md)
- [analysis](./rpi-golden-image-system/rpi-golden-image-system.analysis.md)
- [report](./rpi-golden-image-system/rpi-golden-image-system.report.md)

## 골든 이미지 산출물 (2026-05-22)

`golden-lgw-v20260521.img.xz` — 806MB (압축률 0.026), SHA-256 `f2c90c15...d1208`
- 위치: `~/Projects/golden-images/` (외부, git 미포함 — 빌드 산출물)
- 검증: first-boot-init 18초 정상, reverse-ssh-tunnel 자동 활성화, 서버 → PI SSH 접속 정상
- 핵심 수정: oneshot 데드락 (`apply-gateway-id.sh --no-block`) + PI 계정 lgwadmin 통일

### rpi-golden-image-mass-production (양산 검증 — 9건 BUG 발견 + 5건 fix)
- [plan](./rpi-golden-image-mass-production/rpi-golden-image-mass-production.plan.md)
- [design](./rpi-golden-image-mass-production/rpi-golden-image-mass-production.design.md)
- [analysis](./rpi-golden-image-mass-production/rpi-golden-image-mass-production.analysis.md)
- [report](./rpi-golden-image-mass-production/rpi-golden-image-mass-production.report.md)

### rpi-hostname-gateway-id-unify (hostname+gateway-id 통합 배포)
- [plan](./rpi-hostname-gateway-id-unify/rpi-hostname-gateway-id-unify.plan.md)
- [design](./rpi-hostname-gateway-id-unify/rpi-hostname-gateway-id-unify.design.md)
- [analysis](./rpi-hostname-gateway-id-unify/rpi-hostname-gateway-id-unify.analysis.md)
- [report](./rpi-hostname-gateway-id-unify/rpi-hostname-gateway-id-unify.report.md)
