# Plan: 골든 이미지 빌드 스크립트 hotfix (build-golden-image.sh + prepare-master.sh)

**Feature ID**: `rpi-golden-image-build-fix`
**작성일**: 2026-05-25
**선행 사이클**:
- [rpi-golden-image-system](../../archive/2026-05/rpi-golden-image-system/)
- [rpi-golden-image-mass-production](../../archive/2026-05/rpi-golden-image-mass-production/)
- [rpi-emergency-failover](../../archive/2026-05/rpi-emergency-failover/) (rules.json owner 이슈 연관)
**상태**: Plan (실제 fix는 이미 완료, archive 목적 사이클)

---

## 1. 배경

`lgw-pilot01` 마스터 Pi에서 골든 이미지 v20260525를 빌드하던 중 4가지 Critical/High 버그가 실기에서 발견되었습니다. 빌드가 단계적으로 차단되어 디버깅·수정이 필요했고, 후속 양산 빌드가 동일 경로를 따라가지 않도록 모든 fix를 항구적으로 남깁니다.

## 2. 발견된 BUG 목록

### BUG-1 [Critical] dd raw 임시파일 30GB 디스크 공간 부족
- **증상**: `build-golden-image.sh`가 31GB raw 파일을 `.golden-raw.img`로 저장한 뒤 xz 압축 → 디스크 여유 2.2GB만 남은 환경에서 빌드 불가
- **재현**: `df -h` Avail < 35GB 환경에서 빌드 시도 → ENOSPC
- **영향**: 양산 환경 (Mac 일반 사용자 PC) 다수에서 빌드 불가능

### BUG-2 [High] `SIZE_BYTES` 추출 awk regex 결함
- **증상**: 31.9GB SD 카드를 64GB 초과로 판정 → "거부: ... 3193191498342462333952512 bytes — 64GB 초과는 안전상 차단"
- **원인**: `awk -F: '/Disk Size/ {gsub(/[^0-9]/,"",$2); print $2; exit}'`이 diskutil의 `Disk Size: 31.9 GB (31914983424 Bytes) (exactly 62333952 512-Byte-Units)` 라인의 4개 숫자(31.9, 31914983424, 62333952, 512)를 모두 concat
- **영향**: SD 카드 크기와 무관하게 모든 빌드 실패 — 안전 검증 자체가 잘못된 결정

### BUG-3 [High] sudo dd가 tty 없이 password 못 받음
- **증상**: `bash build-golden-image.sh ... &` (background) 호출 시 내부 `sudo dd`가 `sudo: a terminal is required to read the password` 에러
- **원인**: sudo 기본 동작이 tty 요구. NOPASSWD 설정 없으면 background 자동화 불가
- **영향**: CI/CD 또는 자동 빌드 파이프라인에서 사용 불가

### BUG-4 [Critical] prepare-master.sh가 gateway-id 강제 덮어쓰지 않음
- **증상**: `[ -s /etc/smartfarm/gateway-id ] || echo lgw-default > ...` — 기존 값(예: `lgw-pilot01`)이 있으면 그대로 유지
- **영향**: 양산 시 모든 Pi가 `lgw-pilot01`로 등록 시도 → 서버에서 충돌, 첫 Pi 외 모두 실패
- **관련**: machine-id도 양산 시 unique 보장 필요한데 prepare-master.sh가 초기화 안 함

### BUG-5 [High] prepare-master.sh가 fallback-engine stale 데이터 정리 안 함
- **증상**: `/var/lib/smartfarm/fallback/rules.json` + `fallback.db*`가 마스터 Pi에 남은 채로 골든 이미지에 포함
- **영향**: 양산 Pi 모두 마스터의 stale channelMapping을 가지고 시작 → 첫 sync 메시지 받기 전까지 잘못된 동작 가능
- **추가 발견**: 마스터 Pi의 `rules.json`이 root 소유라 fallback-engine(pi 유저)이 persist 실패 (EACCES) → 디스크 상태 v0 stale

### BUG-6 [Medium] setup.sh chown이 기존 root 소유 파일을 보정 안 함
- **증상**: `chown -R pi:pi $FALLBACK_DATA_DIR`은 디렉터리 내 신규 파일에는 적용되지만, 일부 환경(symlink, mount point)에서 누락 가능
- **영향**: 위 BUG-5의 원인 중 하나

---

## 3. 영향도 평가

| BUG | 양산 영향 | 발견 단계 | Critical? |
|-----|-----------|----------|-----------|
| BUG-1 | 빌드 PC 디스크 여유 따라 빌드 가능 여부 결정 | 빌드 직전 | ✅ Critical |
| BUG-2 | 모든 빌드 100% 실패 | 빌드 직전 | ✅ High |
| BUG-3 | 자동화 빌드 불가 | 빌드 시작 시점 | High |
| BUG-4 | 양산 Pi 첫 1대 외 모두 등록 실패 | 양산 후 검증 | ✅ Critical |
| BUG-5 | stale channelMapping으로 부정확 동작 | 양산 후 실기 사용 | High |
| BUG-6 | 일부 환경에서 BUG-5 재발 | 양산 환경 차이 | Medium |

---

## 4. 목표

1. 디스크 공간 부족 환경(2GB 미만)에서도 빌드 성공
2. 모든 SD 카드 크기에서 안전 검증 정확
3. CI/CD 환경에서 비대화형 자동 빌드 지원
4. 양산 Pi의 gateway-id 강제 unique
5. 마스터 Pi의 stale fallback 데이터가 양산에 전파되지 않음
6. fallback-engine 권한 문제 영구 해결

---

## 5. 범위 (Scope)

### In Scope
- `raspberry-pi/build-golden-image.sh` (BUG-1, 2, 3)
- `raspberry-pi/prepare-master.sh` (BUG-4, 5)
- `raspberry-pi/setup.sh` (BUG-6)

### Out of Scope
- 골든 이미지 자체의 재빌드 (별도 작업)
- 양산 Pi 실기 검증 (다음 사이클)
- 빌드 PC 디스크 정리 자동화

---

## 6. 작업량 산정

수정은 즉시 패치로 이미 완료 (사용자 실기 빌드 중 발견 → fix → 재시도 반복).
- 코드 수정: 약 30분 (3개 스크립트 6개 변경)
- 검증: 빌드 자체로 검증 (현재 진행 중)
- 문서화: 본 사이클 (1시간)

**총 1.5시간**

---

## 7. 다음 단계

본 사이클의 Plan/Design/Analysis/Report 모두 작성 후 즉시 archive (`docs/archive/2026-05/rpi-golden-image-build-fix/`).

선행 사이클들과 같은 archive 폴더에 위치 → 시계열 추적성 확보.
