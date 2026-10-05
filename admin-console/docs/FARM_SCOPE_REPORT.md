# 작업 1 완료 보고 — 백엔드 관리자 농장 컨텍스트

- 브랜치: `feat/farm-context-scope` (worktree `~/Projects/smart-farm-mqtt-farmscope`) · **push 안 함, merge 안 함**
- API 계약: [`FARM_SCOPE_DESIGN.md`](./FARM_SCOPE_DESIGN.md)
- 결과: 빌드 성공 · 전체 테스트 **164/164 통과 (5회 연속)** · 헤더 없는 요청 기준 스냅샷 **97/97 일치**

## 1. 커밋
| 커밋 | 내용 |
|---|---|
| `91e4b48` | 테스트 하네스 + **변경 전 코드에서 만든** 헤더 없는 요청 기준 스냅샷 97건 |
| `c164e30` | 농장 컨텍스트 계약 테스트 (구현 전 실행 → 58 실패 / 7 통과로 테스트가 실제로 검증함을 확인) |
| `29cb1f6` | 구현 (인터셉터·PlatformScope·감사 병합·소켓) |
| `de5b73a` | worktree `CLAUDE.md` "Auth & Roles" 에 사용법·규칙·플랫폼 전용 목록·롤백 |

## 2. 변경 파일
신규 (`backend/src/common/farm-context/`)
- `farm-context.interceptor.ts` — 전역 인터셉터(유일한 적용 지점)
- `farm-context.service.ts` — 대상 검증(HTTP·소켓 공용)
- `farm-context.module.ts` — `@Global`, `APP_INTERCEPTOR` 등록
- `platform-scope.decorator.ts` — `@PlatformScope()`
- `farm-context.storage.ts` — AsyncLocalStorage(감사용)
- `farm-context.constants.ts` — 헤더 이름·에러 코드·예외

수정
- `app.module.ts` — `FarmContextModule` import 1줄
- `activity-log/activity-log.service.ts` — `log()` 에서 농장 컨텍스트면 `details` 에 실제 수행자 병합
- `gateway/events.gateway.ts` — `subscribe:farm` 핸들러 추가, `unsubscribe` 에 `channel==='farm'` 분기 추가(그 외 채널은 기존 그대로)
- `@PlatformScope()` 추가(동작 변경 없음, 메타데이터만): `auth`, `users`, `notifications`, `config-deploy`, `fallback-config` 컨트롤러 전체 / `feature-flags` 3개, `crop-management` 4개, `worker-payroll` 1개, `gateway-manager` 4개 라우트
- `package.json` — jest 설정, devDependencies(`supertest`, `@types/supertest`, `socket.io-client`, `@types/jest`). **런타임 의존성 변경 없음**
- `tsconfig.build.json`(신규) — `test/` 를 운영 빌드에서 제외(빌드 산출물 `dist/main.js` 위치 동일 확인)
- `test/**` — 하네스·픽스처·테스트 4개 파일

DB: **스키마 변경 없음 · 마이그레이션 파일 없음.** (감사 정보는 기존 nullable `details jsonb` 사용 — 설계 §5)

## 3. 조사 표
[`FARM_SCOPE_DESIGN.md` §7](./FARM_SCOPE_DESIGN.md) — 26개 컨트롤러 전 라우트를 FARM / PLATFORM / PUBLIC 으로 분류.

## 4. 테스트 결과
실행: `cd ~/Projects/smart-farm-mqtt-farmscope/backend && npm test`

| 파일 | 건수 | 검증 내용 |
|---|---|---|
| `boot.spec.ts` | 2 | 일회용 `*_test` DB 연결, MQTT mock |
| `regression-no-header.spec.ts` | 97 | (a)(f) 헤더 없는 admin·farm_admin·farm_user 의 주요 GET 응답이 **변경 전 스냅샷과 동일** |
| `farm-context-http.spec.ts` | 54 | (b) admin+헤더 응답 = 해당 농장관리자 응답, 교차 오염 없음 / 플랫폼 라우트는 헤더 무시 / (c) 비관리자 403 / (d) 잘못된 대상 400·404 / (e) actingAdminId 기록, 다른 농장 수정 불가 |
| `farm-context-socket.spec.ts` | 11 | (g) admin 농장 room 입장 시 해당 농장 이벤트만 수신, 농장 변경·퇴장·ack, 비관리자·잘못된 대상 거부, 기존 unsubscribe 동작 유지 |
| **합계** | **164** | **5회 연속 전부 통과** |

- 테스트 DB: 로컬 Postgres 에 `sf_farmscope_test` 를 매 실행 생성·종료 시 삭제. DB 이름이 `_test` 로 끝나지 않으면 실행 자체를 거부(실 DB 보호). 실제 `smartfarm_mqtt` DB·MQTT 브로커에는 접속하지 않음. worktree 백엔드를 서버로 기동하지 않음.
- 중간에 1건 플레이키 발견: 컨트롤러가 activity-log 를 await 없이 기록 → 테스트가 INSERT 전에 조회. **테스트 쪽 대기 누락**이었고(기능 결함 아님) 폴링으로 수정.
- 정적 검사: `nest build` 성공, `tsc --noEmit`(테스트 포함) 오류 0.
- **lint 미실행**: 저장소 backend 에 ESLint 설정 파일이 원래 없어 `npm run lint` 가 동작하지 않음(기존 상태). 설정 추가는 범위 밖이라 하지 않음.

## 5. 남은 위험
- 전체 방송 소켓 이벤트(`irrigation:*`, `rain:override` 등)는 기존처럼 모든 클라이언트에 전달 — 농장 room 과 무관(설계 §8).
- 농장 컨텍스트에서 만든 데이터의 작성자 표시(zone-notes 작성자명, feature `updated_by`)는 농장 관리자. 실제 수행자는 activity-log 에만 남음.
- 기존 보안 이슈(이번 변경과 무관, 별도 과제 권장): `ssh-proxy` 의 셸 연결이 게이트웨이 소유를 검사하지 않음 / `fallback-config` 라우트가 게이트웨이 소유를 검사하지 않음 / 소켓 JWT 검증이 access·refresh 토큰을 구분하지 않음.
- 응답 시간: 농장 컨텍스트 요청마다 users 테이블 PK 조회 1회 추가(헤더 없는 요청은 추가 비용 0).

## 6. 운영 배포 절차 (사용자가 직접 — 승인 후)
> 마이그레이션 없음. 백엔드만 재배포하면 된다. 기존 클라이언트는 헤더를 보내지 않으므로 배포만으로는 화면 변화가 없다.

```bash
# 1) 리뷰 후 main 에 병합 (로컬)
cd ~/Projects/smart-farm-mqtt
git merge --no-ff feat/farm-context-scope     # 또는 PR 로 리뷰·병합
git push origin main

# 2) 운영 서버 백엔드 재배포 (맥미니)
ssh jeongseok@175.206.245.234
zsh -l
cd /Users/jeongseok/Projects/js_farm_mqtt
git pull --ff-only origin main
cd backend && npx nest build && pm2 restart smartfarm_mqtt --update-env
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:3100/api/health
```
- 프론트엔드 재빌드 불필요(기존 앱은 변경 없음).
- 운영 서버에서 `npm test` 를 돌릴 필요는 없다(테스트는 로컬 Postgres 의 일회용 DB 를 만든다 — 운영 DB 서버에서 실행하지 말 것).

## 7. 배포 후 확인 (운영)
1. 기존 앱(`https://urifarm.com:8443`) 관리자 로그인 → 구역 관리에 **모든 농장 구역이 합산**되어 보이는지.
2. 농장 관리자 계정 로그인 → 기존과 같은 화면인지.
3. 관리자 토큰으로 헤더 확인 (토큰은 브라우저 개발자도구에서 복사, 파일에 저장하지 말 것):
   ```bash
   curl -s -H "Authorization: Bearer $T" -H "X-Farm-Context: <농장관리자 id>" -D - https://urifarm.com:8443/api/groups -o /dev/null | grep -i x-farm-context-applied
   ```
   → `x-farm-context-applied: <농장관리자 id>`
4. 농장 관리자 토큰 + 헤더 → `403` `FARM_CONTEXT_FORBIDDEN`.
5. `pm2 logs smartfarm_mqtt` 에 새 오류 없음.

## 8. 롤백
- merge 전: `git worktree remove ../smart-farm-mqtt-farmscope && git branch -D feat/farm-context-scope` (운영 영향 없음)
- merge·배포 후: `git revert -m 1 <merge 커밋>` → push → 서버에서 `git pull && npx nest build && pm2 restart smartfarm_mqtt`.
  DB 스키마 변경이 없으므로 DB 조치 불필요. 이미 기록된 activity-log 의 `details.actingAdminId` 키는 남아도 무해(기존 화면은 details 를 그대로 표시).
