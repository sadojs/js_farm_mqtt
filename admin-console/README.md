# admin-console — 플랫폼 관리자 콘솔 (준비 폴더)

플랫폼 관리자 전용 **PC·태블릿 콘솔**을 기존 앱과 분리해 만들기 위한 폴더입니다.
현재는 **설계 자료만** 들어 있고, 실제 앱 코드는 Claude Code 가 `HANDOFF_PROMPT.md` 를 받아 이 폴더 안에 생성합니다.

## 들어 있는 것
| 경로 | 내용 |
|------|------|
| `RUN_ALL.md` | **Claude Code 에 붙여넣을 연속 실행 프롬프트** (작업 1 → 작업 2) |
| `tasks/01-BACKEND_FARM_SCOPE.md` | 작업 1: 백엔드 농장별 데이터 분리 (옵트인 헤더, worktree 격리) |
| `tasks/02-ADMIN_CONSOLE.md` | 작업 2: PC·태블릿 관리자 콘솔 |
| `docs/ARCHITECTURE.md` | 격리 원칙, 포트(개발 5175 / 운영 8082), 코드 재사용 방식, 반응형 기준, 롤백 |
| `docs/FEATURE_PARITY.md` | 기존 관리자 기능 전체 체크리스트 (모두 동작해야 완료) |
| `docs/design/index.html` | 디자인 시안 뷰어 — 화면 전환 + PC/태블릿 폭 미리보기 |
| `docs/design/01~05-*.html`, `console.css` | 화면별 시안(정적 HTML)과 디자인 토큰·반응형 규칙 |

## 시안 보기
`docs/design/index.html` 을 브라우저로 열기 (Finder 에서 더블클릭).

## Claude Code 로 진행
```bash
cd ~/Projects/smart-farm-mqtt
claude            # Plan mode(Shift+Tab) 권장
# → RUN_ALL.md 의 코드 박스 내용 붙여넣기
```

## 안전장치 요약
- 콘솔 작업 범위는 `admin-console/` 하나. 백엔드 변경은 작업 1 에서 별도 git worktree(`../smart-farm-mqtt-farmscope`)에서만 하고, 메인 폴더의 `frontend/`·`backend/`·루트 파일은 수정 금지
- 기존 Docker 서비스 재시작/재빌드 금지, 운영 배포는 승인 후
- 검증 중 실데이터 변경 동작(사용자 삭제, 설정 배포, 비상 정지 등) 실행 금지

## 마음에 안 들면 (작업 1 백엔드 포함)
```bash
git worktree remove ../smart-farm-mqtt-farmscope && git branch -D feat/farm-context-scope   # 백엔드 작업 폐기 (merge 전이라면 운영 영향 없음)
```
```bash
# (운영 컨테이너를 띄웠던 경우에만)
docker compose -f admin-console/docker-compose.console.yml down
# 폴더 삭제
rm -rf admin-console
```
기존 서비스는 변경된 적이 없으므로 이걸로 끝입니다.
