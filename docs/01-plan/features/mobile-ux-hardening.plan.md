# Plan — mobile-ux-hardening

**Feature**: mobile-ux-hardening (모바일 더블탭 확대 차단 + 로그인 후 사이드바 누락 수정)
**Created**: 2026-06-21
**Owner**: 오정석
**Phase**: Plan

---

## 1. 배경 (Why)

모바일에서 웹앱을 **PWA / 홈화면 단축아이콘으로 앱처럼** 사용 중인데 두 가지 UX 결함이 있다.

### 결함 ①: 더블탭 시 화면 확대
- `index.html` 의 viewport meta 는 이미 `user-scalable=no, maximum-scale=1.0` 설정돼 있다.
- 그러나 **iOS 10+ Safari** 는 접근성 정책상 이 설정을 무시 — 두 손가락 핀치/더블탭 확대가 여전히 동작.
- 앱처럼 사용해야 하는데 사용자가 작은 버튼을 빠르게 두 번 누르면 의도와 무관하게 줌인 → 화면이 어긋남.

### 결함 ②: 로그인 후 사이드바가 가끔 안 보임
코드 분석으로 원인 2개 후보가 잡힌다.

**원인 A (확정적 결함)** — [App.vue:16-285](frontend/src/App.vue#L16-L285)
사이드바 NAV 블록의 분기:
```vue
<nav v-if="isAdmin">...</nav>
<nav v-else-if="isWorker">...</nav>
<nav v-else-if="isFarmAdmin">...</nav>
<!-- farm_user (non-worker) 가 매칭될 블록이 없음 -->
```
farm_user 가 worker 가 아닐 경우 **NAV 블록 자체가 렌더링 되지 않음** → 메뉴 영구히 안 보임.

**원인 B (간헐적 결함)** — [auth.store.ts:24-41](frontend/src/stores/auth.store.ts#L24-L41)
`isWorker = isFarmUser.value && isWorkerAccount.value === true`.
초기값 `isWorkerAccount = null` → `resolveWorkerStatus()` 가 끝나기 전엔
- isAdmin = false
- isWorker = false (null === true 가 false)
- isFarmAdmin = false (farm_user 라서)
→ **모든 분기가 false 인 200~500ms 동안 NAV 가 비어있음**.

사용자가 새로고침 한 뒤 첫 진입에서 가끔 보고 있는 정황과 일치.

---

## 2. 목표 (What)

### Functional Goals

**[F1] 더블탭 확대 완전 차단** — 모든 모바일 OS 에서
- 전역 CSS `touch-action: manipulation` 적용 (300ms 클릭 지연 제거 + 더블탭 확대 차단)
- JS 폴백: `touchend` 이벤트로 350ms 이내 두 번째 탭 감지 시 `preventDefault()`
- iOS 자동 확대 보조 차단: 모든 `<input>` / `<textarea>` / `<select>` 의 font-size 최소 16px 보장
- 가독성 위해 사용자가 의도적으로 확대하고 싶을 만한 화면 (차트/이미지 뷰어 등) 은 예외 처리 클래스 마련

**[F2] 사이드바 NAV 결손 해소**
- A. **farm_user (non-worker) NAV 분기 추가** — Worker 가 아니지만 일반 farm_user 인 사용자에게도 메뉴 노출 (대시보드/구역/방재일정/농작업 등 — 권한 가드는 라우터가 이미 처리)
- B. **worker resolution 동기화** —
  - login 직후 `resolveWorkerStatus()` 를 await 해서 `isWorkerAccount` 가 결정된 뒤에 라우팅
  - 또는 NAV 분기를 `isWorkerAccount === null` 인 동안 **잠정 NAV (farm_user 기본)** 로 표시했다가 확정되면 자연스럽게 전환
- C. **모바일 drawer 닫힘 상태 검증** — 새로고침 후에도 drawer 토글 버튼이 보여야 함 (`mobile-header` 의 햄버거 가시성 확인)

### Non-Functional Goals

- 더블탭 차단이 **빠른 연속 탭(셀 클릭, 버튼 연타)** 의 정상적 단일 탭은 막지 않을 것 (350ms 이내 두 번째만 차단)
- 사용자가 의도적으로 확대하고 싶은 영역 (대시보드 차트 이미지 등) 은 예외 클래스로 허용
- 사이드바 NAV 가 짧은 시간 비어있는 깜빡임 없이 안정적으로 표시
- 로그인 직후 깜빡임/리렌더 없이 한 번에 메뉴 노출

### Out of Scope

- PWA 인증서/설치 가이드 (별도 작업)
- 데스크톱 키보드 단축키
- 사이드바 디자인 변경 (현재 디자인 유지)

---

## 3. 사용자 시나리오

### S1. 모바일 더블탭 확대 차단
1. 사용자가 안드로이드/iOS 에서 PWA 또는 Safari 로 접속
2. 빠르게 버튼을 두 번 탭해도 확대 발생 X
3. input 박스를 탭해도 확대 발생 X (font-size 16px)
4. 차트 영역에서는 두 손가락 핀치줌은 정상 동작 (예외 처리)

### S2. farm_user 로그인 → 사이드바 정상
1. 일반 farm_user (worker 가 아님) 로그인
2. 사이드바가 즉시 표시 — 대시보드/구역/방재/농작업 등 메뉴 노출
3. 라우터는 기존 권한 가드 (`denyFarmUser`) 가 처리 → 자동제어/페일오버는 메뉴에 없거나 클릭 시 차단

### S3. 새로고침 후 worker resolution 깜빡임 제거
1. 사용자가 로그인된 상태에서 F5 / 앱 재시작
2. NAV 가 잠깐 비었다가 채워지는 깜빡임 없이 한 번에 표시
3. 확정 정보(role) 로만 분기 표시

---

## 4. 영향 범위

| 모듈 | 변경 유형 |
|------|----------|
| `frontend/index.html` | viewport meta 그대로 (이미 OK) |
| `frontend/src/style.css` | 전역 `touch-action: manipulation`, input/textarea/select `font-size >= 16px`, 차트/이미지 예외 클래스 |
| `frontend/src/composables/useNoDoubleTapZoom.ts` (신규) | touchend 기반 더블탭 감지·preventDefault |
| `frontend/src/main.ts` 또는 `App.vue` onMounted | useNoDoubleTapZoom 호출 |
| `frontend/src/App.vue` | NAV 분기에 farm_user (non-worker) 블록 추가, 잠정 표시 처리 |
| `frontend/src/stores/auth.store.ts` | `login()` 성공 직후 `resolveWorkerStatus()` await (또는 라우터 가드에서 이미 처리되는지 재확인) |
| `frontend/src/router/index.ts` | beforeEach 에서 worker resolution 동기 보장 — 이미 존재하지만 NAV 가 그 전에 렌더되지 않는지 확인 |

---

## 5. 리스크 & 대응

| 리스크 | 대응 |
|--------|------|
| `touch-action: manipulation` 으로 핀치줌까지 차단 | 차트/이미지에는 `touch-action: pan-x pan-y pinch-zoom` 예외 클래스 |
| JS 더블탭 감지가 정상 빠른 탭을 막음 | 두 번째 탭이 350ms 이내 + 같은 좌표 ±30px 인 경우만 차단 (스크롤·다른 위치 탭 허용) |
| iOS input 16px 강제로 디자인 일관성 깨짐 | `body` 폰트 16px 기본 + 보이는 글자 크기는 CSS 로 줄이고 input 자체 font-size 만 16px 유지 |
| farm_user NAV 분기 추가가 권한 누락 일으킴 | 라우터 `denyFarmUser` 가드가 이미 존재 → NAV 에서도 동일 항목은 숨김 처리 |
| 잠정 NAV → 확정 NAV 전환 시 깜빡임 | `isWorkerAccount === null` 일 때 farm_user 기본 NAV (정산만 가능) 표시 후, 확정되면 자연 전환 |

---

## 6. 성공 기준

- [ ] iOS Safari, Android Chrome 에서 빠르게 두 번 탭해도 확대 X
- [ ] 핀치줌은 차트 영역에서 정상 동작 (예외 처리 확인)
- [ ] input 포커스 시 확대 X
- [ ] farm_user (worker 아님) 로그인 시 사이드바 NAV 즉시 표시
- [ ] 새로고침 / F5 시 NAV 깜빡임 없음 — 첫 페인트부터 안정적으로 노출
- [ ] worker 계정은 기존대로 정산 페이지만 NAV 표시
- [ ] admin / farm_admin 동작 회귀 없음
- [ ] vue-tsc EXIT 0

---

## 7. PDCA 다음

→ `/pdca design mobile-ux-hardening` — 구체 구현 명세 (CSS 코드, JS 훅, NAV 분기 트리)
