# Smart Farm MQTT — E2E 회귀 테스트 가이드

Playwright 기반 자동화 테스트 모음. 사용자에게 "테스트 해줘"라고 요청받으면 이 문서대로 진행합니다.

## 표준 계정

| 역할 | 계정 | 비밀번호 | 권한 범위 |
|---|---|---|---|
| 플랫폼 관리자 | `admin` | `Sessadojs3535!@` | 전체 시스템 + 사용자 관리 |
| 농장 관리자 | `mtest` | `admin123` | 자신의 게이트웨이(lgw-dev) + 룰 |
| 농장 사용자 | `user1` | `admin123` | mtest 농장 일부 권한 (parentUserId=mtest) |

## 디렉토리

```
tests/e2e/
├── helpers.ts          공통 헬퍼 (setup, login, snap, record, saveReport)
├── run.ts              admin 종합 테스트
├── farm-admin-test.ts  mtest 시나리오
├── farm-user-test.ts   user1 시나리오 (TODO 추가)
├── live-trigger.ts     자동제어 룰 실제 트리거 (최대 4분)
├── device-logic.ts     인터록/페어/타이머
└── dark-mode-check.ts  다크모드 단독 검증
```

## 실행

```bash
cd /Users/ohjeongseok/Projects/smart-farm-mqtt

# 전체 회귀 (3계정 순서대로)
npx tsx tests/e2e/run.ts             # admin
npx tsx tests/e2e/farm-admin-test.ts # mtest
npx tsx tests/e2e/farm-user-test.ts  # user1

# 라이브 트리거 (시간 룰)
npx tsx tests/e2e/live-trigger.ts

# 출력 필터링 (PASS/FAIL/WARN만)
npx tsx tests/e2e/run.ts 2>&1 | grep -E "^(✓|✗|⚠|━|Total)"
```

## 사전 조건

- 백엔드 (포트 3100): `node backend/dist/main.js`
- 프론트엔드 (포트 5174~5176): `cd frontend && npm run dev`
- DB (포트 5432, smartfarm_mqtt)
- MQTT (포트 1883)
- RPi 게이트웨이 lgw-dev (SSH 터널 22201)

## 회귀 방지 체크리스트

다음 버그들은 이미 수정됨. 변경 시 회귀 여부 반드시 확인:

| # | 영역 | 회귀 시그널 | 검증 방법 |
|---|---|---|---|
| 1 | 온보드 슬롯 삭제 | 슬롯이 자동 복구됨 | 슬롯 삭제 후 새로고침 → 슬롯 수 그대로 |
| 2 | 자동제어 시간 표시 | `1260 ~ 1320`처럼 raw 분 | conditions 표시가 `HH:MM ~ HH:MM` |
| 3 | 룰 user_id | INSERT 500 (NOT NULL 위반) | admin이 룰 만들 때 group owner 자동 |
| 4 | UUID 쿼리 캐스트 | `operator does not exist: uuid = character varying` | 자동제어 runner 평가 success |
| 5 | device status API | 404 | admin role도 200 OK |
| 6 | onboard device 제어 | MQTT z2m 토픽으로 가서 RPi 무반응 | `farm/{gw}/gpio/relay` publish |
| 7 | 개폐기 인터락 (onboard) | paired OFF가 안 됨 | gpio-agent 로그에 paired 핀 OFF 먼저 |
| 8 | 고아 device | 슬롯 삭제 후 device 카드 남음 | syncOnboardToDevices가 정리 |
| 9 | onboard device verify | UI 자동 OFF로 변경됨 | `source === 'onboard'`면 verified=true |
| 10 | 직접 제어 자동 OFF | 30초 후 자동 OFF | 직접 토글은 ON 유지 |
| 11 | 타이머 버튼 디자인 | Zigbee/GPIO 서로 다른 모양 | 모두 ⏱ 작은 아이콘 |
| 12 | MQTT PK 충돌 | 백엔드 크래시 | try/catch + code 23505 무시 |
| 13 | HTML #app 중복 | 다크모드 검출 실패 | mount point `#vue-root` |
| 14 | GPIO 26핀 | BCM 2,3,7,14,15 거부 | gpio-agent BCM_VALID 26핀 |
| 15 | 자동제어 자연 트리거 | 시간 됐는데 동작 안 함 | RPi 로그에 publish 도달 + relay 동작 |

## 발견된 버그 보고 템플릿

```markdown
## 🐛 발견 버그

### [심각도: 높음/중간/낮음] 한 줄 요약

**증상**:
- 재현 단계 1
- 재현 단계 2

**원인**:
파일 경로:줄번호 — 어떤 코드가 문제인지

**수정 방향**:
구체적인 fix 또는 PR 방향

**회귀 방지**:
체크리스트 N번에 추가
```

## 새 시나리오 추가 시

1. `tests/e2e/` 안에 새 .ts 파일 생성 (helpers import)
2. 페이지 이동, API 호출, snap, record 패턴 사용
3. SKILL.md에 시나리오 추가
4. 이 README 체크리스트에도 추가
