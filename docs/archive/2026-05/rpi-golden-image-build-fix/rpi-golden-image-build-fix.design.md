# Design: 골든 이미지 빌드 스크립트 hotfix

**Feature ID**: `rpi-golden-image-build-fix`
**작성일**: 2026-05-25
**기반 문서**: [Plan](../../01-plan/features/rpi-golden-image-build-fix.plan.md)
**상태**: Design

---

## 1. 아키텍처 (변경 없음, 스크립트 hotfix만)

```
[Mac dev PC]                          [Master Pi]
build-golden-image.sh                 prepare-master.sh
  ├─ dd /dev/r${DISK} ────┐             ├─ hostname → lgw-default
  │  (raw read)           │             ├─ wifi-hq 등록
  │                       ▼             ├─ eth0-static 192.168.0.100
  └─ xz -T0 -9 ──→ *.img.xz             ├─ bootstrap.token 주입
                                        ├─ gateway-id [강제 lgw-default]
                                        ├─ machine-id 초기화
                                        ├─ first-boot-init enable
                                        ├─ fallback-engine 정리 [신규]
                                        └─ apt/journal/fstrim + shutdown
```

선행 사이클 (`rpi-golden-image-system` v20260521)의 워크플로우 유지 — 본 사이클은 6개 BUG fix만.

---

## 2. BUG-1 fix: dd | xz 파이프 (raw 임시파일 제거)

### 기존 코드
```bash
RAW_IMG="${WORK_DIR}/.golden-raw.img"

sudo dd if="/dev/r${DISK}" of="${RAW_IMG}" bs=4m status=progress  # 30GB raw 저장
xz -T0 -9 -c "${RAW_IMG}" > "${WORK_DIR}/${OUTPUT_NAME}"          # 압축
rm -f "${RAW_IMG}"                                                  # raw 삭제
```

**문제**: dd 단계에서 디스크에 31GB 임시 raw 파일 필요 → 디스크 공간 부족 환경 빌드 불가.

### 신규 코드
```bash
# dd 출력을 stdout으로 직접 보내 xz의 stdin으로 파이프
sudo dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
```

**효과**:
- raw 임시파일 0 bytes (디스크 사용)
- 최종 압축 파일 ~1GB만 디스크에 씀
- 메모리 사용 약간 증가 (xz 8 스레드 × ~700MB = ~5.6GB, 일반 Mac 16GB+ 환경에서 무관)
- 빌드 시간 동일 또는 약간 감소 (dd 읽기 즉시 압축 → I/O 병렬)

**Trade-off**: 빌드 중 dd가 stall되면 xz도 stall. 대신 raw 파일 보존 안 되므로 검증 후 재실행 어려움. 한 번 진행하면 끝까지 가야 함.

---

## 3. BUG-2 fix: SIZE_BYTES 추출 sed regex

### 기존 코드
```bash
SIZE_BYTES=$(diskutil info "/dev/${DISK}" | awk -F: '/Disk Size/ {gsub(/[^0-9]/,"",$2); print $2; exit}' || echo "0")
```

**문제**: diskutil의 "Disk Size:" 라인 형식 `Disk Size: 31.9 GB (31914983424 Bytes) (exactly 62333952 512-Byte-Units)` — awk가 $2 영역의 모든 숫자(31.9, 31914983424, 62333952, 512)를 concat → `3193191498342462333952512` 같은 천문학적 값.

### 신규 코드
```bash
# diskutil "Disk Size:" 라인의 괄호 안 정수 Bytes만 sed로 추출
SIZE_BYTES=$(diskutil info "/dev/${DISK}" 2>/dev/null \
  | sed -nE 's/.*Disk Size:[^(]+\(([0-9]+) Bytes\).*/\1/p' \
  | head -1)
[[ -z "$SIZE_BYTES" ]] && SIZE_BYTES=0
```

**검증**:
```
입력 라인: "   Disk Size:                 31.9 GB (31914983424 Bytes) (exactly 62333952 512-Byte-Units)"
sed regex: .*Disk Size:[^(]+\(([0-9]+) Bytes\).*
캡처 그룹: 31914983424
결과 SIZE_BYTES: 31914983424 ← 정확
```

**효과**: 64GB 초과 안전 검증이 정확히 동작. 31.9GB(우리 SD) → 통과, 128GB → 거부.

**Trade-off**: macOS의 diskutil 형식에 의존 (Linux는 lsblk 사용). 하지만 build-golden-image.sh가 처음부터 macOS 전용이므로 OK.

---

## 4. BUG-3 fix: SUDO_ASKPASS 헬퍼 지원

### 기존 코드
```bash
sudo dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
```

**문제**: 인터랙티브 터미널이 아닌 환경(`bash script.sh > log 2>&1 &` 또는 CI)에서 sudo가 password를 받을 tty 없어 실패.

### 신규 코드
```bash
if [ -n "${SUDO_ASKPASS:-}" ]; then
  sudo -A dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
else
  sudo dd if="/dev/r${DISK}" bs=4m status=progress | xz -T0 -9 -c > "${WORK_DIR}/${OUTPUT_NAME}"
fi
```

**사용법**:
```bash
# 자동 빌드용 ASKPASS 헬퍼
cat > /tmp/askpass.sh <<'EOF'
#!/bin/bash
echo 'your-mac-password'
EOF
chmod 700 /tmp/askpass.sh

# 빌드 (sudo -A로 password 자동 입력)
SUDO_ASKPASS=/tmp/askpass.sh bash build-golden-image.sh
```

**대화형 사용은 그대로**:
```bash
# 일반 사용은 종전 그대로 (sudo가 tty에서 password prompt)
bash build-golden-image.sh
```

**효과**:
- 대화형 모드: 변경 없음 (하위 호환)
- 자동 모드: `SUDO_ASKPASS=...` 환경변수 한 줄 추가로 비대화형 빌드 가능

**보안**:
- ASKPASS 스크립트는 700 권한 (소유자만 읽기/실행)
- 빌드 종료 후 사용자가 ASKPASS 스크립트 삭제 책임
- 시스템 sudoers는 변경 안 함 (NOPASSWD 영구화 위험 없음)

---

## 5. BUG-4 fix: prepare-master.sh — gateway-id 강제 + machine-id 초기화

### 기존 코드
```bash
[ -s /etc/smartfarm/gateway-id ] || echo -n "lgw-default" > /etc/smartfarm/gateway-id
[ -s /etc/smartfarm/server-ip ]  || echo -n "172.30.1.42" > /etc/smartfarm/server-ip
log "bootstrap.token (600), gateway-id=lgw-default, server-ip=$(cat /etc/smartfarm/server-ip)"
```

**문제**: 마스터 Pi가 이미 `lgw-pilot01`로 등록된 상태였으면 그 값이 유지됨 → 골든 이미지에 그대로 들어감 → 양산 충돌.

### 신규 코드
```bash
# gateway-id 강제 lgw-default (양산 충돌 방지)
echo -n "lgw-default" > /etc/smartfarm/gateway-id
[ -s /etc/smartfarm/server-ip ]  || echo -n "172.30.1.42" > /etc/smartfarm/server-ip

# machine-id 초기화 (양산 시 각 Pi마다 첫 부팅에서 새로 생성되어 unique 보장)
truncate -s 0 /etc/machine-id 2>/dev/null || true
rm -f /var/lib/dbus/machine-id 2>/dev/null || true
ln -sf /etc/machine-id /var/lib/dbus/machine-id 2>/dev/null || true
log "..., gateway-id=lgw-default (강제), ..., machine-id 초기화"
```

**동작 흐름**:
1. 마스터 Pi: gateway-id를 `lgw-default`로 강제 덮어쓰기 (이전 값 무관)
2. 양산 Pi가 새 SD로 부팅 시:
   - `/etc/machine-id`가 비어있음 → systemd가 부팅 첫 단계에서 새 UUID 생성
   - first-boot-init.service가 `lgw-default`로 register 시도
   - 서버가 `machine-id`와 `bootstrap.token`을 보고 새 gateway 발급 (또는 자동 등록)

**서버 측 동작 검증 필요**: backend의 register-tunnel-key API가 `machine-id`로 unique 식별 후 새 gateway_id 발급하는지 확인 필요 — 본 사이클은 RPi 측만 fix.

---

## 6. BUG-5 fix: prepare-master.sh — fallback-engine 정리

### 신규 코드 (step 6에 추가)
```bash
# rpi-fallback-channel-sync: fallback-engine 양산 정리
# 마스터에서 누적된 rules.json/SQLite를 모두 제거
if [ -d /var/lib/smartfarm/fallback ]; then
  systemctl stop fallback-engine 2>/dev/null || true
  rm -f /var/lib/smartfarm/fallback/rules.json
  rm -f /var/lib/smartfarm/fallback/fallback.db
  rm -f /var/lib/smartfarm/fallback/fallback.db-shm
  rm -f /var/lib/smartfarm/fallback/fallback.db-wal
  if id pi >/dev/null 2>&1; then
    chown -R pi:pi /var/lib/smartfarm/fallback
  fi
  log "fallback-engine 양산 정리: rules.json + fallback.db 제거 + 소유권 pi:pi 보정"
fi
```

**효과**:
- 양산 Pi가 cold boot 시 channelMapping=null 상태로 시작
- 서버에 register 후 retained `fallback/rules/sync` 메시지로 자체 매핑 받음 (각 Pi별로 정확)
- 부산물: 마스터 Pi의 BUG-5 권한 문제도 동시 해결 (rm + chown)

---

## 7. BUG-6 fix: setup.sh — find로 chown 보강

### 기존 코드
```bash
chown -R pi:pi "$FALLBACK_ENGINE_DIR" "$FALLBACK_DATA_DIR"
log_info "fallback-engine 소유자 변경: pi:pi"
```

**문제**: `-R`이 디렉터리 트리는 처리하지만, 일부 환경(이전 root 실행으로 rules.json이 다른 fs metadata 가진 경우)에서 누락 가능.

### 신규 코드
```bash
chown -R pi:pi "$FALLBACK_ENGINE_DIR" "$FALLBACK_DATA_DIR"
# 기존 root 소유로 생성된 파일(rules.json/SQLite)도 보정 (idempotent)
find "$FALLBACK_DATA_DIR" -type f -exec chown pi:pi {} \; 2>/dev/null || true
log_info "fallback-engine 소유자 변경: pi:pi (디렉터리 + 기존 파일 전체)"
```

**효과**: `-R` 누락 케이스를 `find -type f` 명시적 처리로 보완. setup.sh 재실행 시에도 안전 (idempotent).

---

## 8. 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| 1 | `df -h` Avail < 5GB Mac에서 빌드 시도 | 성공 (raw 임시파일 없이 압축 진행) |
| 2 | 31.9GB SD 카드 크기 검증 | 통과 (64GB 초과 거부 안 함) |
| 3 | `bash build-golden-image.sh ... &` background 실행 | SUDO_ASKPASS 없으면 친절한 에러, 있으면 자동 빌드 |
| 4 | 마스터가 `lgw-pilot01`로 설정된 상태에서 prepare-master.sh 실행 | gateway-id를 `lgw-default`로 강제 덮어쓰기 |
| 5 | 마스터에 fallback rules.json 있는 상태에서 prepare-master.sh 실행 | 파일 삭제 + chown pi:pi 적용 |
| 6 | 양산 Pi 첫 부팅 | new machine-id 생성, server에 register, 새 gateway_id 발급, fallback rules.json 새로 sync |

---

## 9. 회귀 영향

| 기존 기능 | 영향 | 검증 |
|-----------|------|------|
| 골든 이미지 v20260521 호환 | 영향 없음 (이미 빌드된 이미지) | n/a |
| build-golden-image.sh 대화형 사용 | 영향 없음 (SUDO_ASKPASS 분기로 하위 호환) | 시나리오 1, 3 |
| prepare-master.sh 기존 7단계 | 영향 없음 (step 4·6 내부 변경만) | 시나리오 4, 5 |
| setup.sh 기존 흐름 | 영향 없음 (find가 추가만) | 시나리오 6 |

---

## 10. 다음 단계

이번 빌드 (현재 진행 중)의 결과로 검증되면 archive. 양산 빌드 (clone-sd.sh로 다른 Pi에 복원) 후 가능하다면 다음 사이클로 양산 검증.
