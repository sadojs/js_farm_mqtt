# 작업 2 — 플랫폼 관리자 PC 콘솔 (admin-console)

> 이 파일은 `admin-console/RUN_ALL.md` 에서 **작업 1(백엔드 농장 스코프) 완료 후** 호출됩니다.
> 작업 1 의 계약서 `admin-console/docs/FARM_SCOPE_DESIGN.md` 를 반드시 먼저 읽을 것.

너는 이 저장소(`smart-farm-mqtt`)에 **플랫폼 관리자 전용 콘솔**을 새로 만든다. 작업 공간은 `admin-console/` 폴더 하나뿐이다.

## 0. 먼저 읽을 것 (순서대로, 모두 읽고 시작)
1. `admin-console/README.md`
2. `admin-console/docs/ARCHITECTURE.md` — 격리 원칙, 포트, 코드 재사용 전략, 반응형 기준, 롤백
3. `admin-console/docs/FEATURE_PARITY.md` — 반드시 동작해야 하는 기존 관리자 기능 전체 목록
4. `admin-console/docs/design/index.html` 과 `01~05-*.html`, `console.css` — 디자인 시안(정답 레이아웃). 브라우저로 열어 PC 1440 / 태블릿 1180 / 820 폭에서 확인
5. `admin-console/docs/FARM_SCOPE_DESIGN.md`, `FARM_SCOPE_REPORT.md` — 작업 1 에서 만든 **농장 컨텍스트 API 계약서** (헤더 이름·에러 코드·소켓 이벤트)
6. 루트 `CLAUDE.md`, `frontend/src/App.vue`, `frontend/src/router/index.ts`, `frontend/src/api/client.ts`, `frontend/src/stores/auth.store.ts`, `frontend/vite.config.ts`

## 1. 절대 규칙 (하나라도 어기면 즉시 멈추고 나에게 보고)
- **`admin-console/` 밖의 파일은 한 글자도 수정·생성·삭제하지 않는다.** (`frontend/`, `backend/`, 루트 `docker-compose.yml`, `.gitignore`, `CLAUDE.md`, `package.json` 포함)
- `frontend/` 는 **읽기와 import 만** 허용. `frontend/` 에서 `npm install`·빌드 실행 금지.
- 백엔드 코드/DB 스키마/환경변수/CORS 설정 변경 금지 (메인 폴더·작업 1 worktree 모두). API 는 기존 엔드포인트 + 작업 1 에서 추가된 농장 컨텍스트 헤더 사용만.
- 작업 1 의 브랜치(`feat/farm-context-scope`)를 merge 하거나 그 백엔드를 기동하지 않는다. 콘솔 작업은 메인 폴더에서 `main` 기반 `feat/admin-console` 브랜치로 한다.
- 실행 중인 기존 Docker 서비스에 `up/down/restart/build` 금지. 조회(`docker ps`, `docker network ls`)만 허용.
- 운영 배포(콘솔 컨테이너 실행 포함)는 **내가 승인할 때까지 하지 않는다.** 파일 작성과 로컬 빌드 확인까지만.
- 실데이터를 바꾸는 동작(사용자 생성/삭제, 게이트웨이 등록/삭제, 설정 배포, 페일오버 설정 저장, 재동기화, **비상 정지**, 장치 제어, 채널/GPIO 테스트)은 **검증 중에 실행하지 않는다.** UI 가 올바른 API 를 호출하도록 연결만 하고, 실제 실행 테스트가 필요하면 나에게 먼저 묻는다.
- git: 새 브랜치 `feat/admin-console` 에서 작업. 커밋은 `admin-console/` 경로만 스테이징(`git add admin-console`). push 는 내가 요청할 때만.
- 매 단계 끝에 `git status --porcelain` 을 실행해 **`admin-console/` 밖 변경이 0건**인지 확인하고 결과를 보고한다.

## 2. 만들 것
### 2-1. 앱 골격 (`admin-console/`)
- Vite 7 + Vue 3 + TypeScript + Pinia + Vue Router (기존과 같은 메이저 버전)
- 개발 서버: **https://localhost:5175** (`@vitejs/plugin-basic-ssl`), proxy `/api` → `http://localhost:3100`, `/socket.io` → `http://localhost:3100` (ws)
- alias: `@` → `../frontend/src`(기존 코드 재사용용), `@console` → `./src`. `server.fs.allow` 에 frontend 경로 추가. `resolve.dedupe` 로 vue/pinia/vue-router 단일 인스턴스 보장
- 기존 `frontend/src/api/client.ts` 가 import 하는 기존 라우터(`../router`)는 alias 로 콘솔 라우터 shim 으로 대체 (ARCHITECTURE.md §4)
- PWA·Capacitor·네이티브 푸시·음성 어시스턴트는 넣지 않는다
- `admin-console/.gitignore` (node_modules, dist), `admin-console/package.json` 스크립트: `dev`, `build`(vue-tsc + vite build), `preview`, `typecheck`

### 2-2. 인증·권한
- 로그인 화면(콘솔 디자인), 기존 `auth.store`/`auth.api` 재사용, 새로고침 시 `initAuth()` 로 세션 복원
- **role !== 'admin' 이면 콘솔 진입 차단**: "플랫폼 관리자 전용" 안내 + 기존 앱(:5174/:81) 링크 + 로그아웃
- `mustChangePassword` 강제 흐름 유지

### 2-3. 콘솔 셸 (시안 그대로)
- 다크 사이드바: 콘솔(플랫폼 개요) / 플랫폼 운영(사용자, 농장, 게이트웨이, 설정 배포, 이머전시 페일오버) / 농장 보기(농장 선택 박스 + 대시보드·구역 관리·자동 제어·방재 일정·일꾼 관리, 기능 플래그 반영) / 하단 API·MQTT 상태 + 버전
- 상단바: 햄버거(태블릿) · 브레드크럼 · 전체 검색(⌘K, 사용자·농장·게이트웨이 즉시 검색) · 알림 센터 · 사용자 메뉴(내 정보, 기능 설정, 로그아웃)
- 농장 보기 중에는 상단 **초록 컨텍스트 바**("○○ 농장을 관리자 권한으로 보는 중" · 농장 변경 · 종료). 선택 농장은 `localStorage` 에 저장(키 접두사 `sf-console-`, 기존 앱 키와 겹치지 않게)
- 반응형: ≥1280 고정 사이드바 / 768–1279 오버레이 드로어 + 상세 패널 아래로 / 표 가로 스크롤 / `pointer:coarse` 터치 크기 (console.css 하단 기준)
- 디자인 토큰은 `console.css` 의 `:root` 값을 `--c-*` 접두사로 옮겨 사용 (기존 전역 CSS 와 충돌 방지). 폰트: IBM Plex Sans KR + JetBrains Mono

### 2-4. 화면
| 경로 | 화면 | 구현 |
|------|------|------|
| `/` | 플랫폼 개요 (시안 01): KPI(농장·사용자·게이트웨이 온라인·측정기 온라인·페일오버), 농장 현황 표, 주의 필요 목록, 게이트웨이 상태 표 — 모두 기존 API 집계 | 신규 |
| `/users` | 사용자 (시안 02): 역할 탭·필터, 트리형 표, 우측 상세(편집·비밀번호 재설정·삭제·기능 권한 토글) | 신규 + 기존 `UserFormModal` 재사용 |
| `/farms` | 농장 (시안 03): 농장 목록, 우측 상세(구역 CRUD·게이트웨이 할당·구성원), "농장 보기" 진입 | 신규 |
| `/gateways` | 게이트웨이 (시안 04): 농장/상태 그룹 표, 우측 상세(상태·터미널·환경 설정·시스템 설정 배포·페일오버·재동기화·비상 정지) | 신규 + 기존 `WebTerminal` 재사용 |
| `/gateways/:id/env` | 게이트웨이 환경 설정 | 기존 `GatewayEnvSettings.vue` 임베드 |
| `/config-deploy` | 설정 배포 | 기존 `ConfigDeploy.vue` 임베드(또는 카드 단위 재사용) |
| `/emergency-failover` | 이머전시 페일오버 | 기존 `EmergencyFailover.vue` 임베드. 비상 정지는 2단계 확인 유지 |
| `/farm/:farmId/dashboard` 등 | 농장 보기 (시안 05) | 기존 Dashboard/Groups/Automation/SpraySchedule/WorkerPayroll/Sensors/Reports/Alerts/ActivityLog/WorkLog/CropManagement 임베드 |

- 기존 화면 임베드는 `<LegacyView>` 래퍼(스코프 클래스 + 중복 헤더 정리)로 감싼다. **기존 파일은 수정하지 않는다.**
- 기존 컴포넌트 안의 `router.push('/gateways/…')`, `router-link to="/dashboard"` 등이 콘솔에서 올바른 화면으로 가도록 콘솔 라우터에 같은 path 를 등록하거나 redirect 한다.
- **농장 컨텍스트 (필수 기능)**: 작업 1 계약서대로 구현한다.
  - 사이드바/농장 목록에서 농장을 선택하면 콘솔 상태(`sf-console-farm` localStorage)에 저장하고, **농장 보기 화면의 모든 API 요청에 `X-Farm-Context: <농장관리자 userId>` 헤더**를 붙인다.
  - 기존 `frontend/src/api/client.ts` 의 axios 인스턴스는 수정하지 않고, 콘솔 부팅 시 그 인스턴스를 import 해서 **콘솔 쪽에서 request interceptor 를 추가**하는 방식으로 붙인다. 헤더는 "농장 보기" 경로에서만 붙이고, 플랫폼 운영 화면(개요·사용자·농장·게이트웨이·설정 배포·페일오버)에서는 붙이지 않는다.
  - 소켓: 계약서의 옵트인 방식(예: `farm:join`/`farm:leave`)으로 선택 농장 이벤트만 받는다. 기존 `useWebSocket.ts` 는 수정하지 않는다(필요하면 콘솔 쪽 래퍼).
  - 농장 변경/종료 시 헤더 제거, 소켓 leave, 관련 Pinia 스토어 캐시 초기화(기존 스토어의 reset/재조회 사용).
  - 컨텍스트 바 문구: "○○ 농장을 관리자 권한으로 보는 중 — 여기서 하는 제어는 이 농장에 실제로 적용됩니다".
  - **현재 실행 중인 백엔드(:3100)에는 작업 1 이 아직 배포되지 않았으므로** 헤더가 무시되어 합쳐진 데이터가 보일 수 있다. 이는 정상. 검증은 (1) 네트워크 요청에 헤더가 정확히 붙는지/빠지는지, (2) 작업 1 의 e2e 테스트가 서버 동작을 보장함을 근거로 한다. 최종 보고에 "백엔드 배포 후 확인할 항목" 체크리스트를 따로 적는다.

### 2-5. 운영 배포 파일 (작성만, 실행 금지)
- `admin-console/Dockerfile` (node build → nginx), `admin-console/nginx.conf` (`/api`, `/socket.io` → `sfm-backend:3100`, SPA fallback), `admin-console/docker-compose.console.yml` (서비스 `admin-console`, 컨테이너 `sfm-admin-console`, 포트 `8082:80`, 기존 네트워크에 `external: true` 로 연결 — 네트워크 이름은 `docker network ls` 로 확인)
- README 에 실행/중지/롤백 명령 기록

## 3. 진행 순서 (단계마다 보고 후 다음으로)
1. **계획**: 읽은 내용 요약, FEATURE_PARITY 항목별 구현 방식(N/L/N+L) 확정, 위험 요소(Vue 중복 인스턴스, 기존 라우터 import, 전역 CSS 충돌, refresh 토큰 회전으로 두 앱 동시 로그인 시 세션 끊김) 대응안
2. 골격 + 인증 + 셸 → `npm run dev` 로 5175 로그인·셸 확인
3. 신규 화면(개요·사용자·농장·게이트웨이)
4. 기존 화면 임베드(E·F·G·H 섹션)
5. 반응형·터치 마감
6. 운영 배포 파일 작성
7. 검증 & 최종 보고

## 4. 검증 (완료 조건)
- `npm run typecheck`, `npm run build` 통과 (admin-console 안에서)
- Playwright(또는 브라우저)로 1440 / 1180 / 820 폭 스크린샷: 개요·사용자·농장·게이트웨이·게이트웨이 환경설정·설정 배포·페일오버·농장 보기 대시보드·구역 관리 — 가로 스크롤(페이지 전체) 없음, 시안과 레이아웃 일치. 스크린샷은 `admin-console/docs/screenshots/` 에 저장
- `FEATURE_PARITY.md` 의 모든 항목 체크(☑). 읽기 동작은 실제로 확인, 쓰기 동작은 "올바른 API·파라미터로 연결됨"을 코드로 확인했다고 표기(실행 X)
- 기존 앱 회귀 없음: `https://localhost:5174` 가 그대로 열리고 로그인되는지 확인, `git status --porcelain` 에 `admin-console/` 밖 변경 0건
- 브라우저 콘솔 에러 0 (경고는 목록으로 보고)
- 농장 보기 경로에서만 `X-Farm-Context` 헤더가 붙고, 플랫폼 운영 화면·농장 보기 종료 후에는 붙지 않음을 네트워크 로그로 확인

## 5. 최종 보고 형식
- 만든 파일 트리 요약, 실행 방법(dev / build / 운영 compose), 패리티 체크 결과표, 스크린샷 경로, 알려진 제약·후속 제안, "백엔드(작업 1) 배포 후 확인할 항목", 롤백 방법

