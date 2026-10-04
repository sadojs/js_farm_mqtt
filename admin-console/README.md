# admin-console — 플랫폼 관리자 콘솔

플랫폼 관리자(role=admin) 전용 **PC·태블릿 웹 콘솔**입니다. 기존 앱(`frontend/`)과 분리된 별도 앱이며,
기존 화면은 `../frontend/src` 를 **수정 없이 import** 해서 콘솔 셸 안에 그대로 띄웁니다.

| 구분 | 주소 |
|------|------|
| 개발 | `https://localhost:5175` (Vite, `/api`·`/socket.io` → `localhost:3100` 프록시) |
| 운영 | `sfm-admin-console` 컨테이너, 기본 포트 **8082** (아래 "운영 실행" — **HTTPS 필수**) |

## 화면 구성
| 섹션 | 화면 | 구현 |
|------|------|------|
| 콘솔 | 플랫폼 개요 `/` | 신규 |
| 플랫폼 운영 | 사용자 `/users` · 농장 `/farms` · 게이트웨이 `/gateways` | 신규 (편집 모달·터미널은 기존 컴포넌트) |
| 플랫폼 운영 | 게이트웨이 환경 설정 `/gateways/:id/env` · 설정 배포 `/config-deploy` · 이머전시 페일오버 `/emergency-failover` | 기존 화면 임베드 |
| 농장 보기 | `/farm/:farmId/{dashboard,groups,automation,…}` | 기존 화면 임베드 + `X-Farm-Context` 헤더 |

- 농장 보기 경로의 API 요청에만 `X-Farm-Context: <farmId>` 를 붙입니다(`src/farm/farmContext.ts`). 플랫폼 화면·셸 공용 데이터는 붙이지 않습니다.
  헤더 계약은 `docs/FARM_SCOPE_DESIGN.md`. **백엔드(작업 1, `feat/farm-context-scope`) 배포 전에는 헤더가 무시되어 농장 보기에서도 전체 농장 데이터가 보입니다.**
- 플랫폼 관리자가 아닌 계정은 로그인 후 안내 화면(기존 앱 링크 + 로그아웃)으로 막습니다.

## 개발
```bash
cd admin-console
npm install          # 콘솔 의존성만 (frontend/ 에는 설치하지 않음)
npm run dev          # https://localhost:5175  (백엔드 :3100 필요)
npm run typecheck
npm run build        # vue-tsc + vite build → dist/
```

### 점검 스크립트 (읽기 전용 — 쓰기 동작 실행 안 함)
```bash
# 모의 API (자격증명·실데이터 불필요)
MOCK=1 node scripts/screenshots.mjs
# 실제 백엔드 — 자격증명은 환경변수로만 (파일·로그에 남기지 않음). 로그인 1회만 수행
CONSOLE_USER=admin CONSOLE_PASS='…' node scripts/screenshots.mjs
CONSOLE_USER=admin CONSOLE_PASS='…' node scripts/smoke.mjs
```
- `screenshots.mjs`: 1440/1180/820 폭 × 9화면 캡처(`docs/screenshots/{mock|live}/{폭}/`), 화면별 브라우저 오류·페이지 가로 스크롤·`X-Farm-Context` 부착 여부 표 출력
- `smoke.mjs`: 로그인 → 농장 선택 → 농장 보기 헤더 부착 / 플랫폼 화면 미부착 확인
- `/auth/login` 은 60초 10회 제한이 있으니 반복 실행하지 마세요.

## 운영 실행 (승인 후)
빌드 컨텍스트는 저장소 루트이고, 들어가는 파일은 `Dockerfile.dockerignore` 로 `admin-console/` 와 `frontend/src`·`frontend/public` 만으로 제한됩니다.
기존 `docker-compose.yml`·기존 컨테이너는 건드리지 않습니다.

```bash
cd <저장소 루트>
docker network ls | grep sfm-network        # 기존 네트워크 이름 확인
# 운영 맥미니 예시: 프로젝트명이 js_farm_mqtt, 백엔드는 호스트 pm2(:3100)
SFM_NETWORK=js_farm_mqtt_sfm-network \
BACKEND_UPSTREAM=host.docker.internal:3100 \
  docker compose -f admin-console/docker-compose.console.yml up -d --build
```

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SFM_NETWORK` | `smart-farm-mqtt_sfm-network` | 기존 compose 네트워크(외부 네트워크로 연결) |
| `BACKEND_UPSTREAM` | `sfm-backend:3100` | nginx 가 `/api`·`/socket.io` 를 넘길 백엔드. 운영처럼 백엔드가 호스트 pm2 면 `host.docker.internal:3100` — 서버의 `sfm-frontend` 가 쓰는 값과 맞추세요(`docker exec sfm-frontend cat /etc/nginx/conf.d/default.conf`) |
| `CONSOLE_PORT` | `8082` | 공개 포트 |
| 빌드 인자 `VITE_SERVER_HOST`/`VITE_SERVER_USER` | `urifarm.com` / `jeongseok` | 게이트웨이 Pi 설치 명령에 들어가는 값(기존 frontend/Dockerfile 과 동일) |

> ⚠️ **HTTPS 필수**: 운영 백엔드(`NODE_ENV=production`)는 refresh 쿠키를 `Secure` 로 내려보냅니다.
> `http://…:8082` 로 열면 브라우저가 쿠키를 저장하지 않아 **로그인은 되지만 새로고침·10분 갱신 시 로그아웃**됩니다.
> 기존 앱처럼 TLS 를 앞단에 두거나(같은 인증서로 리버스 프록시) 콘솔 nginx 에 TLS 를 추가한 뒤 쓰세요.

> ℹ️ **기존 앱과 동시 사용**: 쿠키는 포트가 아니라 호스트 단위라, 같은 호스트의 기존 앱(:8443)과 콘솔은 refresh 쿠키를 공유합니다.
> 한 브라우저에서 두 앱에 각각 다른 계정으로 로그인하면 나중 로그인이 앞 세션을 덮어씁니다. 같은 관리자 계정이면 문제없습니다.

### 확인 · 중지 · 롤백
```bash
docker ps --filter name=sfm-admin-console           # 상태 (healthy)
curl -sI http://localhost:8082/ | head -1           # 200
curl -s  http://localhost:8082/api/health           # 백엔드 프록시 확인
docker compose -f admin-console/docker-compose.console.yml down   # 중지·제거 — 기존 서비스 영향 없음
```

## 폴더
| 경로 | 내용 |
|------|------|
| `src/layouts/ConsoleShell.vue` | 사이드바·상단바·⌘K 검색·농장 선택·컨텍스트 바 |
| `src/farm/farmContext.ts` | 농장 컨텍스트: 헤더 부착, 스토어 초기화, 소켓 farm room |
| `src/views/*View.vue` | 신규 화면 (개요·사용자·농장·게이트웨이·로그인·차단) |
| `src/components/LegacyHost.vue` | 기존 화면 임베드 래퍼 |
| `src/styles/console.css` · `legacy-theme.css` | 콘솔 디자인 토큰 / 기존 화면용 테마 변수 |
| `src/stubs/` | Capacitor(네이티브) 웹 스텁 |
| `docs/` | 설계(ARCHITECTURE, FARM_SCOPE_DESIGN), 기능 동등성(FEATURE_PARITY), 보고서, 스크린샷, 시안(design/) |
| `tasks/`, `RUN_ALL.md`, `HANDOFF_PROMPT.md` | 작업 지시서 |

## 되돌리기
```bash
docker compose -f admin-console/docker-compose.console.yml down     # (운영 컨테이너를 띄운 경우)
git worktree remove ../smart-farm-mqtt-farmscope && git branch -D feat/farm-context-scope   # 백엔드 작업 폐기 (merge 전)
git checkout main && git branch -D feat/admin-console                # 콘솔 브랜치 폐기
```
기존 서비스는 변경된 적이 없으므로 이걸로 끝입니다.
