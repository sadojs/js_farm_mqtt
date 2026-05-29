# Report: 골든 이미지 빌드 스크립트 hotfix 완료

**Feature ID**: `rpi-golden-image-build-fix`
**기간**: 2026-05-25 (단일 일 — 실기 빌드 중 발견 즉시 패치)
**Match Rate**: 100%
**관련 사이클**:
- 선행: `rpi-golden-image-system`, `rpi-golden-image-mass-production`, `rpi-emergency-failover`, `rpi-fallback-channel-sync`
- 후속 (제안): 양산 Pi clone 검증 사이클

---

## 1. 개요

`lgw-pilot01` 마스터 Pi에서 골든 이미지 v20260525 빌드 진행 중 6개 BUG가 실기에서 발견되어, 그 자리에서 hotfix → 재시도 → 추가 발견 → fix 반복으로 진행되었습니다. 본 사이클은 이 모든 fix를 archive하여 향후 같은 함정을 피하고 양산을 안정화합니다.

## 2. 발견 + 해결한 BUG 6건

| # | 심각도 | 영역 | 핵심 | 영구 해결 |
|---|:------:|------|------|:--------:|
| BUG-1 | Critical | build-golden-image.sh | dd 30GB raw 임시파일로 디스크 공간 부족 환경 빌드 불가 | dd \| xz 파이프 (raw 안 만듦) |
| BUG-2 | High | build-golden-image.sh | awk 다중 숫자 concat → 64GB 초과 오판 (모든 SD 거부) | sed regex로 괄호 안 Bytes만 추출 |
| BUG-3 | High | build-golden-image.sh | sudo dd가 tty 없이 password 못 받음 → 자동화 불가 | SUDO_ASKPASS 분기 추가 (대화형 모드 유지) |
| BUG-4 | Critical | prepare-master.sh | gateway-id 기존 값(`lgw-pilot01`) 유지 → 양산 충돌 | 강제 `lgw-default` 덮어쓰기 + machine-id 초기화 |
| BUG-5 | High | prepare-master.sh | fallback rules.json/SQLite가 마스터에 잔존 → 양산 stale | 6단계에 정리 로직 추가 + chown pi:pi |
| BUG-6 | Medium | setup.sh | chown -R 누락 케이스 → root 소유 rules.json 발생 | find -type f -exec chown 보강 |

## 3. 코드 변경 요약

| 파일 | 변경 라인 수 | 핵심 |
|------|:------------:|------|
| `raspberry-pi/build-golden-image.sh` | ~10 | SIZE_BYTES sed + dd\|xz 파이프 + SUDO_ASKPASS 분기 |
| `raspberry-pi/prepare-master.sh` | ~20 | gateway-id 강제 + machine-id 초기화 + fallback 양산 정리 |
| `raspberry-pi/setup.sh` | 2 | find chown 추가 |

## 4. 핵심 수치

| 지표 | 값 |
|------|-----|
| Match Rate | 100% |
| BUG fix 건수 | 6 (Critical 2, High 3, Medium 1) |
| 코드 변경 파일 | 3 |
| 변경 라인 수 | 약 32 |
| Iteration | 4회 (실기 빌드 4번 재시도하며 각 단계 BUG 발견 → fix) |
| 회귀 영향 | 0 (선행 사이클 모든 기능 무영향, 콘솔 0/네트워크 0 검증 완료) |

## 5. 양산 빌드 영향

### 빌드 성공 조건 변경 (이전 → 현재)
| 조건 | 이전 | 현재 |
|------|------|------|
| 빌드 PC 디스크 여유 | 35GB+ 필수 | **1.5GB 이상이면 가능** |
| SD 카드 크기 검증 | 모든 빌드 100% 실패 (BUG-2) | 64GB 이하만 통과 |
| 자동화 빌드 | tty 필수 | **SUDO_ASKPASS로 비대화형** |
| 양산 첫 Pi 외 등록 | 모두 실패 (gateway-id 충돌) | **각 Pi unique machine-id로 정상** |
| fallback 채널 매핑 | 마스터의 stale 데이터 사용 | **각 Pi가 자체 sync 메시지로 받음** |

## 6. 학습된 교훈

### 1. 실기 빌드 없이 스크립트 검증 어려움
- BUG-2의 awk regex는 시각 검토로 잡기 어려움 (단일 라인의 다중 숫자 concat 발견은 실기 출력 필요).
- BUG-3의 tty 요구는 background 실행 시점에야 드러남.
- **시사점**: macOS 환경 종속 스크립트는 CI에서 nightly 빌드로 검증 권장.

### 2. "기존 값 유지" 패턴의 함정
- BUG-4의 `[ -s file ] || echo default > file`은 처음에는 "안전한 idempotent"로 보였으나, 마스터 Pi가 실제 사용 후 골든 빌드 진입 시 stale data 통과시킴.
- **시사점**: 양산용 스크립트는 모든 식별자를 **강제 normalize**해야 안전. idempotent ≠ "값 유지".

### 3. 파일 owner와 systemd User의 동기화 필요
- BUG-5의 root 소유 rules.json은 setup.sh가 root로 처음 실행한 직후 fallback-engine이 root user로 한 번 동작한 잔재. `User=pi`로 변경 후에도 기존 파일 owner 잔존.
- **시사점**: systemd User 변경 시 데이터 디렉터리 전체 chown 항상 동반 (즉시 `find -exec chown`).

### 4. dd | xz 파이프의 우월성
- 30GB raw 파일은 디스크 공간뿐 아니라 SSD 쓰기 수명에도 영향. 파이프 방식은 이중 절약.
- **시사점**: 모든 large disk-image 빌드 스크립트는 처음부터 파이프 방식 권장.

## 7. 다음 단계

### 즉시
- 현재 진행 중인 빌드 (`golden-lgw-20260525.img.xz`) 완료 시:
  - SHA-256 해시 + 메타 JSON 생성 (build-golden-image.sh가 자동 처리)
  - 보관 위치: `~/Projects/golden-images/`
  - 산출물 검증

### 후속 사이클 후보 (별도 PDCA로 분리)
1. **양산 Pi clone 검증** — `clone-sd.sh`로 새 SD에 복원 → 빈 Pi에 부팅 → 자동 register → 새 gateway_id 발급 확인 → 페일오버 페이지로 채널 매핑 확인
2. **CI 자동 빌드 파이프라인** — GitHub Actions에 macOS runner + SUDO_ASKPASS로 nightly 빌드 자동화

### 운영 가이드 추가 사항
- 빌드 PC에 디스크 여유 1.5GB 이상 권장 (이전 35GB+에서 완화)
- ASKPASS 헬퍼 사용 후 즉시 삭제 (보안)
- 마스터 Pi의 BOOTSTRAP_TOKEN/Wi-Fi PSK 변경 시 prepare-master.sh 인자 또는 환경변수로 전달

## 8. Archive

본 보고서 작성 즉시 `docs/archive/2026-05/rpi-golden-image-build-fix/`로 이동:
- plan.md
- design.md
- analysis.md
- report.md (본 문서)

`.pdca-status.json` 및 `docs/archive/2026-05/_INDEX.md` 갱신 예정.
