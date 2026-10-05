# 최종 보고 — 백엔드 농장 컨텍스트(작업 1) + 플랫폼 관리자 콘솔(작업 2)

작성 2026-10-04. 두 작업 모두 **완료**, 멈춤 조건에 걸린 항목 없음(`BLOCKED.md` 없음).
운영 배포·병합·push 는 하지 않았습니다 — 아래 "해야 할 일" 순서대로 진행하면 됩니다.

## 요약
| | 작업 1 — 백엔드 | 작업 2 — 관리자 콘솔 |
|---|---|---|
| 위치 | worktree `../smart-farm-mqtt-farmscope`, 브랜치 `feat/farm-context-scope` | 메인 폴더 `admin-console/`, 브랜치 `feat/admin-console` |
| 내용 | 옵트인 헤더 `X-Farm-Context` — 관리자가 보낼 때만 그 농장 관리자 권한으로 응답. 헤더 없는 요청은 그대로 | PC·태블릿 콘솔(개발 :5175 / 운영 :8082). 신규 화면 4종 + 기존 화면 임베드 + 농장 보기 |
| 검증 | `npm run build` 통과, 테스트 **164/164** (헤더 없는 응답 기준 스냅샷 97건 포함), 5회 연속 통과 | `typecheck`·`build` 통과, 모의 API 캡처 3폭×9화면 **오류 0·가로 스크롤 0**, 실백엔드 스모크(이전 단계) 헤더 13/13 |
| DB 마이그레이션 | **없음** (감사 정보는 기존 `activity_logs.details` jsonb 에 병합) | 해당 없음 |
| 기존 앱(:5174/:8443) 영향 | 헤더를 보내지 않으므로 화면·동작 변화 없음 (스냅샷으로 확인) | 없음 — `frontend/`·`backend/`·루트 파일 변경 0 (아래 격리 확인) |

## 작업 1 — 변경 파일 (`git diff main...feat/farm-context-scope`, 32파일)
- 신규 `backend/src/common/farm-context/` — constants · interceptor · service · storage(AsyncLocalStorage) · module · `@PlatformScope()` 데코레이터
- 수정 `app.module.ts`(모듈 등록), `activity-log.service.ts`(대리 작업 감사 병합), `events.gateway.ts`(소켓 `subscribe:farm` / `unsubscribe farm`)
- `@PlatformScope()` 부착: auth · users · notifications · config-deploy · fallback-config(클래스), feature-flags · crop-management · worker-payroll · gateway-manager(일부 메서드)
- 테스트 하네스 `backend/test/**`(일회용 `*_test` DB, MQTT mock), `package.json`(jest 설정 + devDependencies: supertest, @types/supertest, socket.io-client, @types/jest), `tsconfig.build.json`(test 제외)
- worktree 의 `CLAUDE.md` "Auth & Roles" 에 사용법·규칙 문서화
- 상세: `docs/FARM_SCOPE_DESIGN.md`(계약·조사 표), `docs/FARM_SCOPE_REPORT.md`(테스트·위험·배포·롤백)

## 작업 2 — 변경 파일 (`admin-console/` 만, 커밋 5개)
| 커밋 | 내용 |
|---|---|
| `130d6a2` | 설계 자료 + 작업 1 계약서·보고서 |
| `5983611` | 골격(Vite 7·Vue 3·Pinia)·로그인·차단 화면·셸(사이드바·⌘K·알림·내 정보·기능 설정)·농장 컨텍스트(헤더·스토어 초기화·소켓 room) |
| `5ef6407` | 개요·사용자·농장·게이트웨이 화면, 공용 게이트웨이 모달, 페일오버 요약, 기존 화면 테마(`legacy-theme.css`), 캡처 스크립트 |
| `2f39f74` | 운영 파일 `Dockerfile` · `nginx.conf`(템플릿) · `docker-compose.console.yml` + README |
| `f020d82` | 임베드 페일오버 화면 비상 정지 2단계 확인, FEATURE_PARITY 체크 |

주요 파일: `src/layouts/ConsoleShell.vue`, `src/farm/farmContext.ts`, `src/router/index.ts`, `src/views/{Overview,Users,Farms,Gateways,Login,Blocked}View.vue`, `src/components/{LegacyHost,GatewayFormModal,CIcon}.vue`, `src/stores/platform.store.ts`, `src/composables/{useConsoleFeatures,useFailoverSummary}.ts`, `src/styles/{console,legacy-theme}.css`, `scripts/{smoke,screenshots}.mjs`.

## 테스트 · 빌드 결과
| 항목 | 결과 |
|---|---|
| 작업 1 `npm run build` | 통과 (`dist/main.js` 생성) |
| 작업 1 `npm test` | 164/164 통과 × 5회 연속. 헤더 없는 요청 97건 응답 스냅샷이 변경 전과 동일 |
| 작업 2 `npm run typecheck` / `npm run build` | 통과 / 통과 |
| 작업 2 운영 이미지 빌드 | 로컬 docker 없음 → 이미지와 같은 배치(admin-console + frontend/src·public, `npm ci`, node_modules 연결)를 스크래치 폴더에 재현해 `npm run build` 통과. **실제 `docker build` 는 운영 배포 때 처음 실행됨** |
| 모의 API 캡처 (`MOCK=1 node scripts/screenshots.mjs`) | 27건(9화면×3폭) 브라우저 오류 0, 페이지 가로 스크롤 0, 플랫폼 화면 헤더 부착 0 |
| 실백엔드 스모크 (`scripts/smoke.mjs`, 로컬 :3100 = main 코드) | 로그인 → 셸, 농장 보기 대시보드 임베드, 농장 보기 API 13/13 헤더 부착, 플랫폼 화면 0건, 오류는 로그인 전 `/auth/refresh` 401 1건(정상) |
| 기존 앱 :5174 | 200 응답 (건드리지 않음) |

**경고·제약 목록**
- 실데이터 화면 캡처(`docs/screenshots/live/`)는 만들지 못했습니다 — 로그인 자격증명을 환경변수로 받아야 하는데 이번 무인 실행에서는 쓸 수 없었습니다. 직접 실행: `cd admin-console && CONSOLE_USER=admin CONSOLE_PASS='…' node scripts/screenshots.mjs` (로그인 1회).
- 쓰기 동작(사용자 생성·삭제, 구역 추가·삭제, 게이트웨이 할당, 권한 토글, 재동기화, 비상 정지 등)은 실데이터에 실행하지 않고 **기존 코드와 같은 API·페이로드인지 대조 + 모의 API** 로만 확인했습니다.
- 로컬 백엔드(:3100)는 main 코드라 헤더를 무시합니다 → 지금은 농장 보기에서도 전체 농장이 합산되어 보입니다. 작업 1 배포 후 정상 분리(H10).

## 스크린샷
`admin-console/docs/screenshots/mock/{1440,1180,820}/` — overview, users, farms, gateways, gateway-env, config-deploy, emergency-failover, farm-dashboard, farm-groups (모의 데이터: 가상의 "가나농장/다라농장").

## FEATURE_PARITY 결과
`docs/FEATURE_PARITY.md` — **✅ 60 / 대기 1 (H10: 백엔드 배포 후 확인) / 제외 3 (I1 음성 비서, I2 다크 테마, I3 PWA·네이티브)**. 항목별 확인 방법은 문서 하단 "검증 결과" 표.
- G8 비상 정지: 콘솔 게이트웨이 상세는 확인 → 게이트웨이 ID 입력, 임베드된 기존 페일오버 화면은 콘솔이 클릭을 가로채 확인 → "비상 정지" 입력 후에만 기존 흐름 진행(모의 API 로 2단계 전 API 0건 확인).

## 격리 확인
- 메인 폴더 `frontend/`·`backend/`·`docker-compose.yml`·`.gitignore`·`CLAUDE.md`·`package.json` 변경 **0**.
- `feat/admin-console` 의 main 대비 변경 중 `admin-console/` 밖 파일 **0**.
- `git status` 의 `admin-console/` 밖 항목은 작업 시작 전부터 있던 bkit/pdca·iOS pbxproj·png 들뿐(작업 중 신규 0).
- worktree 백엔드는 실제 DB·MQTT 에 연결해 기동하지 않음(테스트는 일회용 `sf_farmscope_test` DB + MQTT mock). docker build/up/down, 운영 배포, git push 하지 않음.

---

## 해야 할 일 (순서대로)

### 1. 백엔드 브랜치 리뷰 · 병합
```bash
cd ~/Projects/smart-farm-mqtt
git diff main...feat/farm-context-scope -- backend/src     # 핵심 변경만 보기 (테스트·스냅샷 제외)
git -C ../smart-farm-mqtt-farmscope log --oneline -4
# (선택) 로컬 재검증 — 로컬 Postgres 에 일회용 DB 를 만들고 지움. 운영 DB 서버에서 실행 금지
cd ../smart-farm-mqtt-farmscope/backend && npm install && npm run build && npm test
cd ~/Projects/smart-farm-mqtt
git stash -u   # (필요 시) 메인 폴더의 작업 전 변경(bkit 등) 보관
git checkout main && git merge --no-ff feat/farm-context-scope
git push origin main
```

### 2. 마이그레이션
**없음.** DB 조치 불필요.

### 3. 백엔드 재배포 (운영 맥미니)
```bash
ssh jeongseok@175.206.245.234
zsh -l
cd /Users/jeongseok/Projects/js_farm_mqtt
git pull --ff-only origin main
cd backend && npx nest build && pm2 restart smartfarm_mqtt --update-env
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:3100/api/health
```
- 새로 추가된 패키지는 **devDependencies(테스트용)뿐**이라 운영 빌드에 설치가 필요 없습니다. 굳이 설치한다면 `npm ci` 가 아니라 `npm install` (서버 lockfile 은 git 과 별개라 `npm ci` 는 실패할 수 있음).
- 기존 프론트엔드 재빌드 불필요.

### 4. 콘솔 확인 (로컬, 개발 서버)
```bash
cd ~/Projects/smart-farm-mqtt
git checkout feat/admin-console
cd admin-console && npm install && npm run dev      # https://localhost:5175
```
- 관리자로 로그인 → 개요·사용자·농장·게이트웨이 화면 확인 → 사이드바 "농장 보기"에서 농장 선택 → 대시보드·구역 관리.
- 로컬 백엔드를 main(작업 1 병합본)으로 다시 띄우면 농장 보기에서 **선택 농장 데이터만** 보이는지 확인(H10). 상단 컨텍스트 바의 "실시간: 농장 채널 연결됨" 도 이때부터 표시됩니다.
- 실데이터 캡처: `CONSOLE_USER=admin CONSOLE_PASS='…' node scripts/screenshots.mjs`
- 이상 없으면 `feat/admin-console` 을 main 에 병합·push (변경은 `admin-console/` 뿐).

### 5. 콘솔 운영 컨테이너 기동 (운영 맥미니, 승인 후)
> ⚠️ **먼저 결정할 것 — HTTPS.** 운영 백엔드는 refresh 쿠키를 `Secure` 로 보냅니다. `http://…:8082` 로 열면 로그인은 되지만 **새로고침·10분 갱신 때 로그아웃**됩니다.
> 기존 앱(:8443)과 같은 인증서로 TLS 를 붙이세요(콘솔 nginx 에 `listen 443 ssl` + 인증서 마운트, 또는 앞단 리버스 프록시). 이 선택은 서버 인증서 위치에 따라 달라 이번 작업에서는 정하지 않았습니다.

```bash
ssh jeongseok@175.206.245.234
zsh -l
cd /Users/jeongseok/Projects/js_farm_mqtt
git pull --ff-only origin main
docker network ls | grep sfm-network                                  # 보통 js_farm_mqtt_sfm-network
docker exec sfm-frontend cat /etc/nginx/conf.d/default.conf | grep proxy_pass   # 기존 앱이 쓰는 백엔드 주소 확인
SFM_NETWORK=js_farm_mqtt_sfm-network \
BACKEND_UPSTREAM=host.docker.internal:3100 \
  docker compose -f admin-console/docker-compose.console.yml up -d --build
```
- 백엔드가 pm2(호스트)라 기본값 `sfm-backend:3100` 은 운영에서 동작하지 않습니다 → 위 확인 결과에 맞춰 `BACKEND_UPSTREAM` 지정.
- 공유기에서 8082 를 열지 여부도 결정 필요(현재 서버는 방화벽 OFF 상태 — 메모리 기록된 보안 이슈 참고). 관리자 전용이므로 내부망/VPN 만 권장.
- 기존 `sfm-frontend`·`docker-compose.yml` 은 건드리지 않습니다.

## 배포 후 확인
1. 기존 앱(`https://urifarm.com:8443`) 관리자 로그인 → 구역 관리에 **모든 농장 구역이 합산**되어 보이는지(변화 없어야 함).
2. 농장 관리자·농장 사용자 계정으로 기존 앱 → 이전과 같은지.
3. 헤더 동작(토큰은 개발자도구에서 복사, 파일에 저장 금지):
   `curl -s -H "Authorization: Bearer $T" -H "X-Farm-Context: <농장관리자 id>" -D - https://urifarm.com:8443/api/groups -o /dev/null | grep -i x-farm-context-applied` → 해당 id.
   농장 관리자 토큰 + 헤더 → `403 FARM_CONTEXT_FORBIDDEN`.
4. 콘솔: `docker ps --filter name=sfm-admin-console`(healthy), `curl -sI http://localhost:8082/` 200, `curl -s http://localhost:8082/api/health` 정상.
5. 콘솔 로그인 → 농장 보기에서 선택 농장 데이터만 보임, 플랫폼 화면은 전체. 새로고침해도 로그인 유지(HTTPS 확인).
6. `pm2 logs smartfarm_mqtt` 새 오류 없음.

## 롤백
| 단계 | 방법 | 영향 |
|---|---|---|
| 콘솔 컨테이너 | `docker compose -f admin-console/docker-compose.console.yml down` | 기존 서비스 영향 없음 |
| 콘솔 코드 | 병합 전: `git branch -D feat/admin-console` / 병합 후: `git revert -m 1 <merge>` | `admin-console/` 만 |
| 백엔드 (병합 전) | `git worktree remove ../smart-farm-mqtt-farmscope && git branch -D feat/farm-context-scope` | 운영 영향 없음 |
| 백엔드 (배포 후) | `git revert -m 1 <merge>` → push → 서버 `git pull && cd backend && npx nest build && pm2 restart smartfarm_mqtt --update-env` | DB 조치 불필요. 이미 기록된 `activity_logs.details.actingAdminId` 는 남아도 무해 |

## 후속 제안
- 운영 HTTPS 구성 확정 후 콘솔 nginx 에 TLS 블록 추가.
- 실데이터 캡처로 화면 재확인, 이상 시 `docs/screenshots/live/` 와 비교.
- 다크 테마(I2)·기존 앱의 글자 크기 설정 연동은 2차.
