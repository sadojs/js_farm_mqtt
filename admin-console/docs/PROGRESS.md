# 진행 기록 (PROGRESS)

| 시간 (KST) | 한 일 | 다음 할 일 |
|---|---|---|
| 10-04 08:01 | 지시서·ARCHITECTURE·FEATURE_PARITY 읽음. 환경 확인: backend 에 jest 설정/테스트 0개, eslint 설정 없음, 로컬 docker 없음, postgres15(Homebrew) 사용 가능 | 작업1 worktree 생성, 엔드포인트 전수 조사 |
| 10-04 08:14 | [작업1] worktree 생성, 엔드포인트 전수 조사(서브에이전트 2개), 테스트 하네스(일회용 *_test DB·MQTT mock·크론 정지) 구축, 변경 전 기준 스냅샷 97건 생성·안정성 확인 후 커밋 | 계약 설계(FARM_SCOPE_DESIGN.md), 스코프·403·감사·소켓 테스트 작성 |
| 10-04 08:25 | [작업1] 계약서 작성 → 계약 테스트 선작성(구현 전 58실패 확인) → 인터셉터·PlatformScope·감사 병합·소켓 farm room 구현. 빌드 OK, 전체 164건(기준 스냅샷 97 포함) 1회차 통과, 플레이키 1건(테스트의 비동기 로그 대기 누락) 수정 후 5회 연속 통과 | worktree CLAUDE.md 문서화, FARM_SCOPE_REPORT 작성 |
| 10-04 08:27 | [작업1 완료] worktree CLAUDE.md 문서화(de5b73a), FARM_SCOPE_REPORT.md 작성. 게이트(빌드+전체 테스트 164) 통과 → 작업2 진행 | 작업2: feat/admin-console 브랜치, 콘솔 골격·인증·셸 |
| 10-04 08:43 | [작업2] 계획 → feat/admin-console 브랜치, 골격·인증·셸·농장 컨텍스트 구현. typecheck 통과, 스모크(로그인·셸·기존 대시보드 임베드·헤더 13/13 부착·플랫폼 0건). admin-console 밖 신규 변경 0건 | 신규 화면(개요·사용자·농장·게이트웨이) |
| 10-04 09:01 | [작업2] 신규 화면 4종(개요·사용자·농장·게이트웨이) + 공용 게이트웨이 모달·페일오버 요약, 기존 화면 임베드 테마 변수(legacy-theme.css) 보완. typecheck·build 통과. 모의 API 캡처(MOCK=1, 실데이터 접근 없음) 3폭×9화면: 오류 0·가로 스크롤 0·플랫폼 화면 헤더 0, 농장 화면은 인증·셸 플랫폼 호출만 미부착. 실서버 로그인 캡처는 자격증명을 환경변수로 받아야 해 사용자 실행 대기(README 안내) | 운영 파일(Dockerfile·nginx·compose), FEATURE_PARITY 갱신, FINAL_REPORT |
| 10-04 09:04 | [작업2] 운영 파일: Dockerfile(루트 컨텍스트, frontend/src 읽기 전용 복사, node_modules 심볼릭 연결)·nginx.conf(템플릿, BACKEND_UPSTREAM)·docker-compose.console.yml(sfm-admin-console, 8082, external 네트워크 SFM_NETWORK). 로컬 docker 없음 → 스크래치 폴더에서 이미지와 같은 배치로 npm ci + build 재현 통과. 운영 확인 사항 문서화: 백엔드는 호스트 pm2(→ host.docker.internal:3100), 네트워크 js_farm_mqtt_sfm-network, refresh 쿠키 Secure → HTTPS 필수. README 갱신 | FEATURE_PARITY 갱신, FINAL_REPORT |
