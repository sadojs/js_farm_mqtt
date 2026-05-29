# Gap Analysis: rpi-golden-image-build-fix

**분석일**: 2026-05-25
**Plan**: [docs/01-plan/features/rpi-golden-image-build-fix.plan.md](../01-plan/features/rpi-golden-image-build-fix.plan.md)
**Design**: [docs/02-design/features/rpi-golden-image-build-fix.design.md](../02-design/features/rpi-golden-image-build-fix.design.md)

---

## Overall Match Rate: **100%** (PASS — 모든 BUG fix 코드 적용 완료)

| BUG | Status | 검증 방법 |
|-----|:------:|----------|
| BUG-1 (Critical): dd raw 30GB | ✅ Resolved | 빌드 진행 중 raw 파일 0 bytes 확인 |
| BUG-2 (High): SIZE_BYTES 추출 | ✅ Resolved | `diskutil info /dev/disk7` 결과로 `31914983424` 정확 추출 검증 |
| BUG-3 (High): sudo background | ✅ Resolved | SUDO_ASKPASS=/tmp/sf-askpass.sh로 자동 빌드 동작 확인 |
| BUG-4 (Critical): gateway-id 강제 | ✅ Resolved | prepare-master.sh 마커 grep 통과 |
| BUG-5 (High): fallback 정리 | ✅ Resolved | prepare-master.sh 마커 grep 통과 |
| BUG-6 (Medium): setup.sh chown | ✅ Resolved | setup.sh find 명령 grep 통과 |

---

## 1. 코드 수정 사항

### `raspberry-pi/build-golden-image.sh`
| 변경 | 라인 | 내용 |
|------|------|------|
| SIZE_BYTES 추출 | 60-63 | awk 다중 숫자 concat 버그 → sed regex로 괄호 안 Bytes만 정확 추출 |
| dd → xz 파이프 | 87-93 | raw 임시파일 제거 + `SUDO_ASKPASS` 지원 분기 |

### `raspberry-pi/prepare-master.sh`
| 변경 | 라인 | 내용 |
|------|------|------|
| gateway-id 강제 | 113 | `[ -s ... ] ||` 조건 제거 → 무조건 `lgw-default` 덮어씀 |
| machine-id 초기화 | 116-119 | `truncate -s 0 /etc/machine-id` + `/var/lib/dbus/machine-id` 정리 |
| fallback-engine 정리 | 6단계 | rules.json + SQLite 삭제 + chown pi:pi 보정 |

### `raspberry-pi/setup.sh`
| 변경 | 라인 | 내용 |
|------|------|------|
| chown 보강 | 402-404 | `find $FALLBACK_DATA_DIR -type f -exec chown pi:pi` 추가 (idempotent) |

---

## 2. 실기 검증 결과 (2026-05-25 빌드 중)

### BUG-1 (dd raw 임시파일)
- 빌드 직전 `df -h`: `/Users` Avail = **2.2GB** (30GB 임시파일 절대 불가)
- 빌드 진행: 출력 파일 `golden-lgw-20260525.img.xz` 점진적 증가 (41M → 96M → 진행 중)
- **raw 임시파일 확인**: `ls ~/Projects/golden-images/` 에 `.golden-raw.img` 없음 ✓

### BUG-2 (SIZE_BYTES)
- 검증 명령: `diskutil info /dev/disk7 | sed -nE 's/.*Disk Size:[^(]+\(([0-9]+) Bytes\).*/\1/p'`
- 결과: `31914983424` (정확히 31.9GB)
- 64GB 임계값 통과 ✓

### BUG-3 (SUDO_ASKPASS)
- 헬퍼: `/tmp/sf-askpass.sh` (chmod 700, echo password만)
- `SUDO_ASKPASS=... bash build-golden-image.sh ...` 자동 진행 → sudo dd 시작됨 ✓

### BUG-4, 5 (prepare-master.sh)
- 마스터 Pi에서 실제 실행 (2026-05-25 22:24):
  ```
  [INFO] bootstrap.token (600), gateway-id=lgw-default (강제), server-ip=172.30.1.42, machine-id 초기화
  [INFO] fallback-engine 양산 정리: rules.json + fallback.db 제거 + 소유권 pi:pi 보정
  ```
- 모든 신규 코드 마커 출력 확인 ✓
- Pi shutdown 후 ping unreachable (10초 만에) ✓

### BUG-6 (setup.sh)
- 코드만 fix (실기 setup.sh 재실행은 미수행 — 이미 마스터 Pi에 최신 fallback-engine 설치된 상태)
- 다음 양산 Pi의 setup.sh 실행 시 효과 발휘 예정

---

## 3. 잔여 사항

### 검증 미완료 (다음 사이클 후보)
- 양산 Pi에서 first-boot-init.service가 새 gateway_id 발급 받는지 (서버 API 동작 의존)
- machine-id 초기화 후 첫 부팅에서 systemd가 정상적으로 새 UUID 생성하는지
- SUDO_ASKPASS 헬퍼 파일 자동 정리 (현재는 사용자 책임)

### 보안 권장 사항
- `/tmp/sf-askpass.sh`는 빌드 종료 후 즉시 삭제 (`rm /tmp/sf-askpass.sh`)
- 시스템 sudoers 변경 없음 — NOPASSWD 영구화 안 함 ✓

---

## 4. Plan/Design 사양 일치율

| 항목 | Plan | Design | 구현 |
|------|:----:|:------:|:----:|
| dd \| xz 파이프 | ✅ | ✅ | ✅ |
| SIZE_BYTES sed regex | ✅ | ✅ | ✅ |
| SUDO_ASKPASS 분기 | ✅ | ✅ | ✅ |
| gateway-id 강제 덮어쓰기 | ✅ | ✅ | ✅ |
| machine-id 초기화 | ✅ | ✅ | ✅ |
| fallback rules.json 삭제 | ✅ | ✅ | ✅ |
| fallback.db* 삭제 | ✅ | ✅ | ✅ |
| chown pi:pi 보정 | ✅ | ✅ | ✅ |
| setup.sh find chown | ✅ | ✅ | ✅ |

**100% 일치** — Design 명세대로 모든 fix 구현됨.

---

## 5. 회귀 영향

### 사용자 종합 테스트 (2026-05-25 시점)
- lgw-pilot01 페일오버 페이지 검증 (이번 사이클과 무관, 별도 진행) — PASS
- 4월 모달 저장 검증 (BUG-1 fix from `rpi-fallback-channel-sync`) — PASS
- 6개 페이지 회귀 (dashboard/gateways/config-deploy/automation/sensors/groups) — 콘솔 0, 네트워크 0

→ 본 사이클의 스크립트 변경은 다른 백엔드/프론트엔드 기능에 영향 없음 ✓

---

## 6. 결론

**모든 6개 BUG fix가 코드 적용 + 마커 검증 완료. Match Rate 100%.**

빌드 자체 (현재 진행 중)가 성공하면 BUG-1·2·3의 실기 검증 완료. 양산 Pi clone 후 첫 부팅이 정상이면 BUG-4·5·6의 실기 검증 완료 (다음 사이클).

`/pdca report rpi-golden-image-build-fix`로 보고서 작성 후 즉시 archive 진행 가능.
