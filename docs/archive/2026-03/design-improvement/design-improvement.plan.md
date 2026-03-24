# Plan: design-improvement (UI/UX 디자인 개선)

> 디자인 리뷰 결과 기반 Critical/Major 이슈 해결

## 1. 배경 및 문제

### 디자인 리뷰 결과 요약
- **종합 점수**: 72/100
- **리뷰 일시**: 2026-02-28
- **리뷰 범위**: Admin(플랫폼 관리자) + Farm(홍길동) 계정, Desktop(1440px) + Mobile(780px), 총 70개 스크린샷
- **리뷰 보고서**: `docs/design-review-report.md`

### 주요 문제점

1. **모바일 모달 UX 심각** - 모달이 full-screen으로 열리지 않고 배경 콘텐츠와 겹침
2. **버튼 상태 관리 미흡** - "0개 추가" 같은 의미 없는 액션 버튼이 활성 상태
3. **날짜 포맷 불일치** - mm/dd/yyyy (미국식)과 yyyy-mm-dd (ISO) 혼재
4. **빈 상태(Empty State) CTA 부족** - 데이터 없을 때 텍스트만 표시, 행동 유도 없음
5. **리포트 모바일 레이아웃 깨짐** - 기간 버튼 세로 쌓임, "다운로드" 줄바꿈, 테이블 잘림
6. **모바일 터치 타겟 미달** - 44px 최소 기준 미충족 아이콘 버튼 존재
7. **자동화 동작 영문 표시** - "open" 등 동작값이 한국어화 안 됨

## 2. 요구사항 (FR)

### FR-01: 모바일 모달 Full-Screen Bottom Sheet 전환
- **심각도**: Critical (C-01)
- **현황**: 모바일에서 모달이 데스크톱과 동일한 centered dialog로 렌더링되며, 배경 콘텐츠가 스크롤되면서 겹쳐 보임
- **영향 모달**: 장비등록, 환경설정, 그룹추가, 장비추가, 배치추가, 룰수정, 룰추가 (총 7개)
- **구현 방향**:
  - 모바일(max-width: 768px)에서 모달을 full-screen bottom sheet로 전환
  - CSS: `position: fixed; inset: 0; border-radius: 16px 16px 0 0` (또는 전체 화면)
  - `body.modal-open { overflow: hidden }` 으로 배경 스크롤 차단
  - backdrop overlay opacity 0.5 → 0.7로 증가
  - 모달 내부 스크롤은 별도 처리 (`overflow-y: auto`)
- **영향 파일**: Groups.vue (환경설정/그룹추가/장비추가), Harvest.vue (배치추가), Automation.vue (룰수정/추가), Devices.vue (장비등록), 공통 모달 CSS
- **우선순위**: Critical

### FR-02: "0개 추가" 버튼 Disabled 처리
- **심각도**: Critical (C-02)
- **현황**: 그룹에 장비 추가 모달에서 추가 가능한 장비가 0개인데 "0개 추가" 버튼이 클릭 가능
- **구현 방향**:
  - 선택된 항목이 0개일 때 버튼을 `:disabled` 처리
  - 버튼 텍스트를 선택 개수에 따라 동적 변경: `0개 → "장비를 선택하세요" (disabled)` / `N개 → "N개 추가"`
  - disabled 스타일: `opacity: 0.5; cursor: not-allowed; pointer-events: none`
- **영향 파일**: Groups.vue (장비 추가 모달 영역)
- **우선순위**: Critical

### FR-03: 날짜 포맷 yyyy-MM-dd 통일
- **심각도**: Medium-High (C-03)
- **현황**: 배치 추가 모달의 파종일/정식일이 브라우저 기본 `mm/dd/yyyy` 포맷 사용, 다른 페이지에서는 `2026-04-01` 형식 사용
- **구현 방향**:
  - 모든 `<input type="date">`에 대해 표시 포맷을 `yyyy-MM-dd`로 통일
  - VueDatePicker 사용 중인 곳은 `format="yyyy-MM-dd"` prop 적용
  - 네이티브 date input은 CSS 또는 커스텀 컴포넌트로 통일
  - Harvest.vue 배치 목록의 날짜 표시와 동일하게 맞춤
- **영향 파일**: Harvest.vue (배치 추가 모달), Reports.vue (기간 선택)
- **우선순위**: High

### FR-04: 빈 상태(Empty State) CTA 개선
- **심각도**: Medium (M-02, M-03)
- **현황**:
  - 장비 관리: "등록된 장비가 없습니다" + 우편함 이미지 + "장비 추가" 버튼 (양호)
  - 환경 모니터링: "센서가 등록된 그룹이 없습니다" + 부제만 (CTA 없음)
  - 센서 알림: "활성 센서가 없습니다" + 부제만 (CTA 없음)
  - 대시보드: 가동 장비 0/0, 센서 현황 0/0 → 카드 안에 텍스트만
- **구현 방향**:
  - 환경 모니터링: 3단계 가이드 텍스트 + "장비 관리로 이동" 버튼 추가
  - 센서 알림: "장비를 등록하고 센서를 활성화하세요" + "장비 관리" 링크
  - 대시보드 카드: 빈 상태일 때 "설정하기" 인라인 링크 추가
- **영향 파일**: Sensors.vue (환경 모니터링), Alerts.vue, Dashboard.vue
- **우선순위**: Medium

### FR-05: 리포트 모바일 레이아웃 개선
- **심각도**: Medium (M-04)
- **현황**:
  - 기간 선택 버튼이 세로로 쌓여 과도한 공간 차지
  - "다운로드" 라벨이 "다운로\n드"로 줄바꿈
  - farm 모바일에서 상세 데이터 테이블 컬럼 잘림
- **구현 방향**:
  - 기간 선택: 가로 스크롤 가능한 flex 행으로 변경 (`flex-wrap: nowrap; overflow-x: auto`)
  - 다운로드 영역: 아이콘 버튼으로 변경하거나 `white-space: nowrap` 적용
  - 상세 데이터 테이블: `overflow-x: auto` 래퍼 추가로 가로 스크롤 허용
- **영향 파일**: Reports.vue
- **우선순위**: Medium

### FR-06: 모바일 터치 타겟 44px 확보
- **심각도**: Medium (mob-02)
- **현황**: 그룹 관리 카드의 아이콘 버튼들(⚙, +, 🗑, ▼)이 터치 타겟 44px 미만
- **구현 방향**:
  - 모바일에서 아이콘 버튼에 `min-width: 44px; min-height: 44px` 적용
  - 또는 아이콘들을 `⋮` 더보기 메뉴로 통합하여 드롭다운에서 텍스트와 함께 표시
  - WCAG 2.5.5 Target Size 기준 충족
- **영향 파일**: Groups.vue
- **우선순위**: Medium

### FR-07: 자동화 동작 한국어화
- **심각도**: Low (m-07)
- **현황**: 자동화 룰 카드에서 동작 값이 "open" 등 영문 그대로 표시
- **구현 방향**:
  - 동작 코드 → 한글 매핑 객체 추가: `{ open: '열기', close: '닫기', on: '켜기', off: '끄기' }`
  - Automation.vue 카드 표시 시 매핑 적용
  - 미매핑 값은 원본 표시 (fallback)
- **영향 파일**: Automation.vue
- **우선순위**: Low

### FR-08: 그룹 아이콘 버튼 Tooltip 추가
- **심각도**: Low (m-03)
- **현황**: 그룹 카드 상단 아이콘 버튼(⚙, +, 🗑, ▼)에 label/tooltip 없음
- **구현 방향**:
  - 각 아이콘 버튼에 `title` attribute 추가: "환경설정", "장비 추가", "그룹 삭제", "접기/펼치기"
  - CSS `:hover::after` 또는 native `title`로 간단 구현
- **영향 파일**: Groups.vue
- **우선순위**: Low

## 3. 구현 순서

| Phase | FR | 작업 내용 | 의존성 | 예상 난이도 |
|-------|-----|----------|--------|-----------|
| 1 | FR-01 | 모바일 모달 Full-Screen 전환 (7개 모달) | 없음 | High |
| 2 | FR-02 | "0개 추가" 버튼 disabled 처리 | 없음 | Low |
| 3 | FR-03 | 날짜 포맷 yyyy-MM-dd 통일 | 없음 | Low |
| 4 | FR-04 | 빈 상태 CTA 개선 (3개 페이지) | 없음 | Medium |
| 5 | FR-05 | 리포트 모바일 레이아웃 개선 | 없음 | Medium |
| 6 | FR-06 | 모바일 터치 타겟 44px 확보 | 없음 | Low |
| 7 | FR-07 | 자동화 동작 한국어화 | 없음 | Low |
| 8 | FR-08 | 그룹 아이콘 Tooltip | 없음 | Low |

> Phase 1이 가장 작업량이 크며 (7개 모달 수정), 나머지는 독립적으로 진행 가능

## 4. 비기능 요구사항

- **반응형**: 모바일(< 768px), 태블릿(768-1024px), 데스크톱(> 1024px) 3단계 대응
- **접근성**: WCAG 2.5.5 터치 타겟 44px, 키보드 네비게이션 유지 (모달 ESC 닫기)
- **호환성**: 기존 다크모드/라이트모드 CSS 변수 시스템과 충돌 없이 적용
- **성능**: CSS-only 변경 위주, JavaScript 로직 변경 최소화
- **하위호환**: 데스크톱 UX에 영향 없음 (모바일 전용 CSS 미디어쿼리)

## 5. 변경 파일 예상

### 수정 파일

| # | 파일 | FR | 변경 내용 |
|---|------|-----|----------|
| M1 | `frontend/src/views/Groups.vue` | FR-01,02,06,08 | 모달 full-screen + 장비추가 disabled + 터치타겟 + tooltip |
| M2 | `frontend/src/views/Harvest.vue` | FR-01,03 | 배치추가 모달 full-screen + 날짜포맷 |
| M3 | `frontend/src/views/Automation.vue` | FR-01,07 | 룰위저드 모달 full-screen + 동작 한국어화 |
| M4 | `frontend/src/views/Devices.vue` | FR-01 | 장비등록 모달 full-screen |
| M5 | `frontend/src/views/Reports.vue` | FR-05 | 모바일 레이아웃 (기간버튼/다운로드/테이블) |
| M6 | `frontend/src/views/Sensors.vue` | FR-04 | 빈 상태 CTA + 가이드 |
| M7 | `frontend/src/views/Alerts.vue` | FR-04 | 빈 상태 CTA |
| M8 | `frontend/src/views/Dashboard.vue` | FR-04 | 빈 상태 인라인 링크 |

### 신규 파일: 없음 (모두 기존 파일 수정)

## 6. 검증 방법

### 체크리스트

| # | 검증 항목 | FR |
|---|----------|-----|
| 1 | 모바일에서 7개 모달 모두 full-screen으로 열림 | FR-01 |
| 2 | 모달 오픈 시 배경 스크롤 차단됨 | FR-01 |
| 3 | 모달 닫기 시 배경 스크롤 복원됨 | FR-01 |
| 4 | 데스크톱에서 모달 기존 동작 유지 | FR-01 |
| 5 | 장비 0개 시 추가 버튼 disabled + 텍스트 변경 | FR-02 |
| 6 | 장비 N개 선택 시 추가 버튼 활성화 + "N개 추가" 표시 | FR-02 |
| 7 | 배치 추가 모달 날짜 표시가 yyyy-MM-dd 형식 | FR-03 |
| 8 | 리포트 날짜 선택도 yyyy-MM-dd 형식 통일 | FR-03 |
| 9 | 환경 모니터링 빈 상태에 "장비 관리로 이동" CTA 표시 | FR-04 |
| 10 | 센서 알림 빈 상태에 CTA 표시 | FR-04 |
| 11 | 대시보드 빈 카드에 "설정하기" 링크 표시 | FR-04 |
| 12 | 리포트 모바일: 기간 버튼이 가로 스크롤 | FR-05 |
| 13 | 리포트 모바일: "다운로드" 줄바꿈 안됨 | FR-05 |
| 14 | 리포트 모바일: 데이터 테이블 가로 스크롤 가능 | FR-05 |
| 15 | 그룹 아이콘 버튼 모바일 터치 타겟 44px 이상 | FR-06 |
| 16 | 자동화 동작 "open"→"열기" 등 한국어 표시 | FR-07 |
| 17 | 그룹 아이콘에 tooltip 표시 | FR-08 |
| 18 | 프론트엔드 빌드(vue-tsc + vite) 통과 | 전체 |

## 7. 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| 모달 full-screen 전환 시 내부 스크롤 깨짐 | 긴 폼이 스크롤 안 될 수 있음 | 모달 body에 `overflow-y: auto; max-height: calc(100vh - header)` |
| 배경 스크롤 차단이 iOS에서 안 됨 | Safari에서 배경 스크롤됨 | `-webkit-overflow-scrolling: touch` + `position: fixed` body |
| 날짜 input의 브라우저별 포맷 차이 | Chrome/Safari 표시 다름 | VueDatePicker로 통일하거나 커스텀 date input 사용 |
| 빈 상태 CTA가 라우팅 깨질 수 있음 | 링크 클릭 시 404 | `router-link`로 구현하여 라우터 경로 참조 |
