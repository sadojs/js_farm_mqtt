# 연속 실행 지시서 — 작업 1(백엔드 농장 스코프) → 작업 2(PC 관리자 콘솔)

> 사용법: `~/Projects/smart-farm-mqtt` 에서 `claude` 실행 → 아래 박스 안의 내용을 그대로 붙여넣기.
> 사용자가 자리를 비운 상태에서 끝까지 진행하도록 작성되어 있습니다.

```
~/Projects/smart-farm-mqtt 저장소에서 두 작업을 순서대로 끝까지 진행해줘. 나는 지금 자리를 비우니까 중간 승인 없이 진행하되, 아래 "멈춤 조건"에 걸리면 그 지점에서 멈추고 상황을 정리해 둬.

[읽을 파일]
- admin-console/README.md
- admin-console/tasks/01-BACKEND_FARM_SCOPE.md   ← 작업 1 지시서
- admin-console/tasks/02-ADMIN_CONSOLE.md        ← 작업 2 지시서
- admin-console/docs/ARCHITECTURE.md, admin-console/docs/FEATURE_PARITY.md
- admin-console/docs/design/ (시안: index.html, 01~05-*.html, console.css)

[순서]
1. 작업 1: tasks/01-BACKEND_FARM_SCOPE.md 를 지시서대로 수행한다.
   - 반드시 git worktree(../smart-farm-mqtt-farmscope, 브랜치 feat/farm-context-scope)에서 작업한다.
   - 산출물: admin-console/docs/FARM_SCOPE_DESIGN.md (API 계약서), admin-console/docs/FARM_SCOPE_REPORT.md
   - 빌드·전체 테스트가 통과해야 작업 2로 넘어간다. 통과하지 못하면 멈춘다.
2. 작업 2: tasks/02-ADMIN_CONSOLE.md 를 지시서대로 수행한다.
   - 메인 폴더에서 main 기반 feat/admin-console 브랜치로 작업한다. 작업 범위는 admin-console/ 하나뿐이다.
   - 작업 1의 계약서(FARM_SCOPE_DESIGN.md)대로 농장 선택 시 X-Farm-Context 헤더와 소켓 farm room을 사용한다.
3. 두 작업 모두 끝나면 admin-console/docs/FINAL_REPORT.md 에 통합 보고서를 쓴다.
   - 각 작업의 변경 파일, 테스트·빌드 결과, 스크린샷 경로, FEATURE_PARITY 체크 결과를 정리한다.
   - 내가 직접 해야 할 일도 순서대로 적는다: 백엔드 브랜치 리뷰/merge → 마이그레이션 실행 → 백엔드 재배포 → 콘솔 확인 → 콘솔 운영 컨테이너 기동.
   - 백엔드 배포 후 확인할 항목, 롤백 방법도 포함한다.

[공통 절대 규칙]
- 운영 중인 서비스에 영향 0.
  · 메인 폴더의 frontend/, backend/, 루트 파일(docker-compose.yml, .gitignore, CLAUDE.md 등)은 수정하지 않는다.
  · 백엔드 변경은 작업 1의 worktree 안에서만 한다.
- 기존 앱(:5174)의 화면과 동작은 바뀌면 안 된다. 특히 플랫폼 관리자의 구역 관리 화면은 지금처럼 모든 농장이 한 번에 보여야 한다.
- 기존 플랫폼 관리자 기능은 새 콘솔에서 전부 동작해야 한다(FEATURE_PARITY.md).
- docker compose build/up/down/restart 금지, 운영 배포 금지, git push 금지.
- worktree의 백엔드를 실제 DB나 MQTT에 연결해 기동하지 않는다.
  (개발 모드는 synchronize로 실제 DB 스키마가 바뀌고, 자동제어가 실제 장치를 중복 제어할 위험이 있다)
- 실데이터를 바꾸는 동작은 실행하지 않는다: 사용자 생성/삭제, 장치 제어, 설정 배포, 페일오버 저장, 재동기화, 비상 정지, 채널/GPIO 테스트.
- 비밀값(.env, 토큰, 비밀번호)을 파일·로그·보고서에 쓰지 않는다.

[멈춤 조건] — 아래에 걸리면 진행을 멈추고, 그때까지의 결과와 막힌 이유·선택지를 admin-console/docs/BLOCKED.md 에 적는다
- 규칙을 지키면서는 진행할 수 없는 상황(예: 메인 폴더 백엔드/프론트 수정이 꼭 필요해 보임)
- 작업 1의 빌드나 테스트가 3번 시도 후에도 실패
- 헤더 없는 요청의 응답이 변경 전과 달라지는 것이 발견됨
- 권한 상승 가능성이 해결되지 않음
- 판단이 크게 갈리는 설계 결정(되돌리기 어려운 DB 변경 등)

[진행 기록]
- 단계가 끝날 때마다 admin-console/docs/PROGRESS.md 에 시간, 한 일, 다음 할 일을 한 줄씩 추가한다.
- 커밋: 작업 1은 worktree 브랜치에, 작업 2는 feat/admin-console 브랜치에 admin-console/ 경로만 단계별로 나눠서 한다.
```

## 돌아와서 확인할 것
1. `admin-console/docs/FINAL_REPORT.md` — 결과와 다음 할 일 (멈췄다면 `BLOCKED.md`)
2. `admin-console/docs/PROGRESS.md` — 진행 기록
3. `admin-console/docs/screenshots/` — 콘솔 화면
4. 백엔드 변경은 `../smart-farm-mqtt-farmscope` 폴더(브랜치 `feat/farm-context-scope`)에서 리뷰
