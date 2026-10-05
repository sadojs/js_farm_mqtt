# 관리자 콘솔 아키텍처 결정 (ADR)

## 1. 목표
- 플랫폼 관리자(role=admin) 전용 **PC·태블릿 콘솔**을 기존 앱과 **완전히 분리된 별도 앱**으로 만든다.
- 기존 서비스(`frontend/` :5174 개발 / :81 운영, `backend/` :3100)에는 **영향 0**.
- 마음에 들지 않으면 `admin-console/` 폴더 삭제(+ 콘솔 컨테이너 중지)만으로 원상 복구.

## 2. 격리 원칙 (위반 시 작업 중단)
| 대상 | 허용 | 금지 |
|------|------|------|
| `admin-console/**` | 생성·수정·삭제 | — |
| `frontend/**` | **읽기 · import 만** | 파일 수정/생성/삭제, `npm install`, 빌드 산출물 변경 |
| `backend/**`, DB, MQTT | 읽기(코드 분석), 기존 API **호출** | 코드·스키마·환경변수 변경, 마이그레이션 — **단, 작업 1(농장 스코프)만 예외: git worktree `feat/farm-context-scope` 에서 옵트인 헤더 기능 추가** |
| 루트 파일 (`docker-compose.yml`, `.gitignore`, `CLAUDE.md`, `package.json` …) | 읽기 | 수정 |
| 실행 중인 Docker 서비스 | `docker ps`, `docker network ls` 같은 조회 | `up/down/restart/build` (기존 서비스) |

> 백엔드 CORS 기본값은 `http://localhost:5174` 하나뿐입니다. **콘솔은 반드시 같은 오리진 프록시(Vite proxy / nginx)로 API를 호출**해서 CORS 변경이 필요 없게 만듭니다.

## 3. 런타임 구성

```
[개발]  브라우저 ──https://localhost:5175──▶ Vite(admin-console)
                                           ├─ /api        → http://localhost:3100  (proxy)
                                           └─ /socket.io  → http://localhost:3100  (proxy, ws:true)

[운영]  브라우저 ──http://<맥미니>:8082──▶ nginx(sfm-admin-console 컨테이너, 신규)
                                           ├─ /api        → http://sfm-backend:3100
                                           └─ /socket.io  → http://sfm-backend:3100
        (기존 sfm-frontend:81 과 독립. 같은 docker 네트워크에 external 로만 붙음)
```

- 포트: 개발 **5175**, 운영 **8082** (사용 중이면 다른 빈 포트로, 문서에 기록).
- 운영용 파일은 `admin-console/Dockerfile`, `admin-console/nginx.conf`, `admin-console/docker-compose.console.yml` 로 **별도 compose 파일**에 둔다. 기존 `docker-compose.yml` 은 건드리지 않는다.
  실행 예: `docker compose -f admin-console/docker-compose.console.yml up -d --build` (네트워크는 `external: true`, 이름은 `docker network ls` 로 확인 — 보통 `smart-farm-mqtt_sfm-network`).
- **운영 배포는 사용자 승인 후에만**. 이번 작업에서는 파일 작성 + 로컬 빌드 확인까지만.
- 인증 쿠키(refresh)는 호스트 단위라 포트가 달라도 공유됨 → 같은 호스트에서 기존 앱과 콘솔 동시 로그인 가능. 단 refresh 토큰 회전(rotation) 때문에 **두 앱을 동시에 띄우면 한쪽 세션이 끊길 수 있음** → 확인 후 README 에 주의사항으로 기록.

## 4. 코드 재사용 전략

기능 동등성을 가장 안전하게 보장하는 방법은 **복잡한 기존 화면을 다시 쓰지 않고 그대로 import 해서 콘솔 셸 안에 넣는 것**입니다.

- Vite alias
  - `@` → `../frontend/src` (기존 컴포넌트 내부의 `@/…` import 가 그대로 동작하도록)
  - `@console` → `./src` (콘솔 자체 코드)
  - `fs.allow` 에 `..` 의 `frontend` 경로 추가
- 의존성: 기존 컴포넌트가 쓰는 패키지(vue, pinia, vue-router, axios, socket.io-client, chart.js, vue-chartjs, dayjs, @vuepic/vue-datepicker, @xterm/*, @vueuse/core …)를 **`admin-console/package.json` 에 같은 버전대로** 설치. `frontend/node_modules` 를 참조하지 말 것.
  - 기존 소스가 `../frontend/src` 에 있어 Node 모듈 해석이 `frontend/node_modules` 로 갈 수 있음 → `resolve.dedupe: ['vue','pinia','vue-router']` + 필요 시 패키지별 alias 로 **콘솔 node_modules 하나만** 쓰게 고정. (Vue 인스턴스가 두 벌 로드되면 pinia/inject 가 깨짐 — 반드시 검증)
- 기존 `api/client.ts` 가 `../router` (기존 라우터)를 import 해서 401 시 `router.push('/login')` 합니다.
  → 콘솔에서는 **alias 로 해당 모듈을 콘솔 라우터로 대체**(예: `frontend/src/router/index.ts` 절대경로 → `admin-console/src/router/legacy-router-shim.ts`)하여 기존 라우터 인스턴스가 생기지 않게 합니다. 대체 방법은 구현 시 검증하고 이 문서에 결과를 적을 것.
  - 마찬가지로 기존 컴포넌트가 `useRouter()`/`router-link` 로 기존 경로(`/gateways/:id/env`, `/dashboard` 등)를 쓰는 곳이 있으므로, 콘솔 라우터에 **기존 경로를 동일 path 로 등록**하거나 redirect 를 둔다.
- 스타일 충돌
  - 기존 `frontend/src/style.css` 의 CSS 변수/전역 규칙은 임베드 화면에 필요. 콘솔 토큰은 `--c-*` 접두사로 분리해 충돌을 피한다.
  - 임베드 화면은 `<LegacyView>` 래퍼(`.legacy-scope`) 안에서 렌더하고, 콘솔 셸(사이드바·상단바)은 legacy 전역 CSS 영향을 받지 않도록 클래스명을 `c-` 로 시작.
  - 기존 화면의 자체 페이지 헤더/여백이 콘솔 헤더와 중복되면 래퍼에서 CSS 로만 숨기거나 조정(기존 파일 수정 금지).
- 새로 만드는 화면(N): 개요, 사용자, 농장, 게이트웨이 목록·상세, 콘솔 셸, 로그인. API 호출은 기존 `api/*.api.ts` 를 그대로 import.

## 4-1. 농장 컨텍스트
- 백엔드(작업 1)가 `X-Farm-Context: <농장관리자 userId>` 헤더를 지원. 헤더가 없으면 기존과 동일(관리자=전체 합산).
- 콘솔은 기존 axios 인스턴스(`frontend/src/api/client.ts`)를 수정하지 않고, import 후 **콘솔 쪽에서 request interceptor 를 추가**해 "농장 보기" 경로에서만 헤더를 붙인다.
- 소켓은 작업 1 계약서의 옵트인 room 방식 사용.
- 상세 계약: `docs/FARM_SCOPE_DESIGN.md` (작업 1 산출물)

## 5. 반응형 기준
| 폭 | 레이아웃 |
|----|----------|
| ≥1280px | 사이드바 고정 232px, 목록+상세 가로 배치 |
| 768–1279px (태블릿 가로·세로) | 사이드바 → 햄버거로 여는 오버레이 드로어, 상세 패널은 목록 아래로, 표는 가로 스크롤 |
| <768px | 지원 범위 밖 — 최소 동작만, "PC/태블릿에서 이용" 안내 배너 |
| `pointer: coarse` | 버튼 ≥40px, 메뉴 행 ≥44px, 스위치 확대 |

시안 `docs/design/console.css` 하단의 미디어쿼리가 기준입니다.

## 6. 롤백
1. 운영 컨테이너를 띄웠다면: `docker compose -f admin-console/docker-compose.console.yml down`
2. `rm -rf admin-console`
3. 기존 서비스는 처음부터 변경되지 않았으므로 추가 조치 없음.
