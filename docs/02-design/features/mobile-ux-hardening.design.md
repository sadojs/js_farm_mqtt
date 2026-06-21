# Design — mobile-ux-hardening

**Feature**: mobile-ux-hardening
**Created**: 2026-06-21
**Phase**: Design — depends on `mobile-ux-hardening.plan.md`

---

## 1. 전체 아키텍처

```
┌─ 모바일 OS (iOS Safari / Android Chrome) ────────────┐
│                                                       │
│  index.html: viewport user-scalable=no (이미 설정)    │
│  ──> iOS 는 무시 ❌                                    │
│                                                       │
│  ▼ 추가 방어층 (이번 설계 범위)                          │
│  ① CSS  : touch-action: manipulation (전역)            │
│  ② CSS  : input/textarea/select font-size >= 16px      │
│  ③ JS   : useNoDoubleTapZoom() — touchend 더블탭 차단  │
│  ④ CSS  : .allow-zoom 예외 클래스 (차트/이미지)         │
└──────────────────────────────────────────────────────┘

┌─ 사이드바 NAV 결손 ──────────────────────────────────┐
│                                                       │
│  현재 분기:                                            │
│   v-if=isAdmin / v-else-if=isWorker /                 │
│   v-else-if=isFarmAdmin / v-else (farm_user 일반)     │
│                                                       │
│  결손 케이스 ①:                                        │
│    farm_user 로그인 직후 isWorkerAccount=null →       │
│    isWorker 가 잠시 false → v-else 가 잠깐 보임       │
│    → 곧 resolveWorkerStatus() 완료 → NAV 깜빡임        │
│                                                       │
│  결손 케이스 ②:                                        │
│    모바일에서 drawer 닫힘 + 햄버거 가시성 불량         │
│                                                       │
│  ▼ 해결                                                │
│  A. login() 직후 await resolveWorkerStatus()           │
│  B. NAV 분기 명시화 (v-else → v-else-if=isFarmUser)   │
│  C. role 미확정 동안 NAV 빈 슬롯 대신 loading 표시     │
│  D. 모바일 햄버거 z-index/visibility 강화              │
└──────────────────────────────────────────────────────┘
```

---

## 2. 결함 ① — 더블탭 확대 차단 구현

### 2.1 전역 CSS — `style.css` 보강

```css
/* 모바일 더블탭 확대 방지 + 300ms 클릭 지연 제거 */
html {
  touch-action: manipulation;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.04);
}
body {
  touch-action: manipulation;
  overscroll-behavior-y: none;  /* iOS 바운스 스크롤 차단 — 앱 느낌 */
}

/* iOS 가 input 포커스 시 자동 확대하는 것 방지 — 16px 이상 필수 */
input, textarea, select, button {
  font-size: max(16px, 1em);
}

/* 사용자가 의도적으로 확대해야 하는 영역은 예외 */
.allow-zoom,
.allow-zoom * {
  touch-action: pan-x pan-y pinch-zoom;
}
```

적용 대상 `.allow-zoom` 클래스 (차트/이미지 뷰어):
- Chart.js 캔버스 컨테이너
- 이미지 미리보기 모달
- 지도(있다면)

### 2.2 JS 폴백 — `composables/useNoDoubleTapZoom.ts` (신규)

CSS 만으로 못 막는 일부 구형 안드로이드 브라우저용 보강.

```typescript
import { onMounted, onBeforeUnmount } from 'vue'

/**
 * touchend 두 번이 350ms 이내 + 같은 좌표 ±30px → 두 번째 preventDefault.
 * 정상적 빠른 단일 탭(첫 번째)은 통과시키고, 두 번째 탭(확대 트리거)만 차단.
 * .allow-zoom 자손은 예외.
 */
export function useNoDoubleTapZoom(threshold = 350, radius = 30) {
  let lastTap = 0
  let lastX = 0
  let lastY = 0

  function handler(e: TouchEvent) {
    const target = e.target as HTMLElement | null
    if (target?.closest('.allow-zoom')) return

    const now = performance.now()
    const t = e.changedTouches[0]
    if (!t) return

    const dt = now - lastTap
    const dx = Math.abs(t.clientX - lastX)
    const dy = Math.abs(t.clientY - lastY)

    if (dt > 0 && dt <= threshold && dx <= radius && dy <= radius) {
      e.preventDefault()
      lastTap = 0
      return
    }
    lastTap = now
    lastX = t.clientX
    lastY = t.clientY
  }

  onMounted(() => {
    document.addEventListener('touchend', handler, { passive: false })
  })
  onBeforeUnmount(() => {
    document.removeEventListener('touchend', handler)
  })
}
```

### 2.3 호출 위치 — `App.vue`

```typescript
import { useNoDoubleTapZoom } from './composables/useNoDoubleTapZoom'

useNoDoubleTapZoom()
```

---

## 3. 결함 ② — 사이드바 NAV 안정화

### 3.1 원인 A 처리 — `auth.store.ts` `login()` 동기화

로그인 직후 worker 여부를 미리 결정해서 NAV 분기 깜빡임 제거.

```typescript
async function login(username: string, password: string) {
  loading.value = true
  try {
    const { data } = await authApi.login(username, password)
    accessToken.value = data.accessToken
    user.value = data.user
    isWorkerAccount.value = null
    // 새: farm_user 라면 worker 여부를 결정해야 NAV 가 안 깜빡임
    if (user.value?.role === 'farm_user') {
      await resolveWorkerStatus()  // null → true/false 확정
    } else {
      isWorkerAccount.value = false  // 다른 role 은 즉시 확정
    }
    startSilentRefreshTimer()
  } finally {
    loading.value = false
  }
}
```

`initAuth()` (새로고침 케이스) 도 같은 패턴 적용:
```typescript
async function initAuth() {
  try {
    const { data } = await authApi.refresh()
    accessToken.value = data.accessToken
    await fetchUser()
    if (user.value) {
      // 새: farm_user 인 경우 worker 여부 확정 후 mount 진행
      if (user.value.role === 'farm_user') await resolveWorkerStatus()
      else isWorkerAccount.value = false
      startSilentRefreshTimer()
    }
  } catch {
    user.value = null
    accessToken.value = null
  }
}
```

### 3.2 원인 B 처리 — `App.vue` NAV 분기 명시화

`v-else` 를 명시적인 `v-else-if="isFarmUser"` 로 변경하고, 마지막 `v-else` 는 **role 미확정 로딩 상태** 처리.

```vue
<aside v-if="showShell" class="sidebar">
  ...
  <nav v-if="isAdmin" class="sidebar-nav">...</nav>

  <!-- worker 결정 전엔 잠시 로딩 표시 (깜빡임 대신 일관된 상태) -->
  <nav v-else-if="isFarmUser && !roleResolved" class="sidebar-nav sidebar-nav-loading">
    <div class="nav-loading-skeleton" aria-busy="true" aria-label="메뉴 불러오는 중">
      <span></span><span></span><span></span>
    </div>
  </nav>

  <nav v-else-if="isWorker" class="sidebar-nav">
    <!-- 일꾼 메뉴 -->
  </nav>

  <nav v-else-if="isFarmAdmin" class="sidebar-nav">
    <!-- 농장 관리자 메뉴 -->
  </nav>

  <nav v-else-if="isFarmUser" class="sidebar-nav">
    <!-- farm_user 일반 메뉴 -->
  </nav>

  <!-- 미인증 / 예외 — 빈 상태가 보이지 않게 -->
</aside>

<script setup>
const roleResolved = computed(() =>
  authStore.isAdmin
  || authStore.isFarmAdmin
  || (authStore.isFarmUser && authStore.isWorkerAccount !== null)
)
</script>
```

`useAuthStore` 에 `isWorkerAccount` 가 이미 export 되어 있어 store 직접 접근으로 가능.

CSS 추가 (로딩 스켈레톤):
```css
.sidebar-nav-loading { padding: 16px; }
.nav-loading-skeleton { display: flex; flex-direction: column; gap: 10px; }
.nav-loading-skeleton span {
  height: 14px; border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-hover) 0%, var(--border-light) 50%, var(--bg-hover) 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.2s infinite;
}
.nav-loading-skeleton span:nth-child(1) { width: 70%; }
.nav-loading-skeleton span:nth-child(2) { width: 90%; }
.nav-loading-skeleton span:nth-child(3) { width: 60%; }
@keyframes skeleton-shimmer { 0%{background-position: 200% 0} 100%{background-position: -200% 0} }
```

### 3.3 원인 C 처리 — 모바일 햄버거 가시성 보강

`App.vue` 의 `mobile-header` 가 항상 위에 오도록:

```css
.mobile-header {
  position: sticky;          /* fixed 가 아닐 경우 sticky 로 */
  top: 0;
  z-index: 100;
  display: none;              /* 데스크톱은 숨김 (기존 그대로) */
}
@media (max-width: 768px) {
  .mobile-header { display: flex; }
}
.hamburger {
  min-width: 44px;
  min-height: 44px;
  /* iOS 최소 탭 사이즈 */
}
```

drawer overlay 의 z-index 도 점검.

### 3.4 ESC / 라우트 변경 시 drawer 자동 닫기 (이미 있으면 확인만)

```typescript
import { watch } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
watch(() => route.fullPath, () => { isDrawerOpen.value = false })
```

---

## 4. 영향 매트릭스

| 파일 | 변경 |
|---|---|
| `frontend/src/style.css` | touch-action / input 16px / .allow-zoom / 로딩 스켈레톤 |
| `frontend/src/composables/useNoDoubleTapZoom.ts` (신규) | JS 더블탭 차단 |
| `frontend/src/App.vue` | useNoDoubleTapZoom 호출 / NAV 분기 명시 + 로딩 상태 / 라우트 변경 시 drawer 닫기 |
| `frontend/src/stores/auth.store.ts` | login() + initAuth() 내 worker resolve await |
| `frontend/index.html` | viewport meta 그대로 유지 |

비-IoT/기능 모듈 — 변경 없음.

---

## 5. UI/UX 시나리오 매트릭스

| 사용자 | 시나리오 | 결과 |
|---|---|---|
| admin | 로그인/새로고침 | NAV 즉시 표시, 깜빡임 X |
| farm_admin | 로그인/새로고침 | NAV 즉시 표시 |
| farm_user (worker) | 로그인 | resolveWorkerStatus await → /worker-payroll redirect → 일꾼 NAV 표시 |
| farm_user (non-worker) | 로그인 | resolveWorkerStatus await → /dashboard → farm_user 일반 NAV |
| 모든 사용자 | 빠른 더블탭 | 확대 X (CSS + JS 이중 차단) |
| 모든 사용자 | 차트 핀치줌 | 정상 (.allow-zoom 예외) |
| 모든 사용자 | input 포커스 | 확대 X (font-size 16px) |
| 모바일 | drawer 토글 | 햄버거 항상 보임, 라우트 변경 시 자동 닫힘 |

---

## 6. 잠재 부작용 & 회피

| 부작용 | 대응 |
|---|---|
| input/textarea 의 font-size: 16px 강제 → 디자인 변경 | 시각적 글자 크기는 padding 으로 조정, font-size 만 16px 유지 |
| touch-action: manipulation 이 일부 컨테이너의 스크롤 막음 | manipulation 은 single-tap + pan 허용. 스크롤은 정상 |
| useNoDoubleTapZoom 의 e.preventDefault() 가 폼 제출 막을 가능성 | touchend 만 차단, click 은 통과 — 폼 영향 X |
| 로딩 스켈레톤이 빠른 네트워크에서 깜빡 | 200ms 미만이면 표시 생략 (선택 — 첫 구현에선 단순 유지) |

---

## 7. 구현 순서 (Do 체크리스트)

### 7.1 더블탭 차단
- [ ] `style.css` 전역 touch-action / input 16px / .allow-zoom 클래스 추가
- [ ] `useNoDoubleTapZoom.ts` 신규
- [ ] `App.vue` setup 에서 호출
- [ ] `.allow-zoom` 클래스를 Chart.js 컨테이너에 부착 (있는 위치 — dashboard 차트, reports SensorCompareChart)

### 7.2 사이드바 NAV 안정화
- [ ] `auth.store.ts` login() / initAuth() 에서 farm_user 일 때 await resolveWorkerStatus()
- [ ] `auth.store.ts` export 에 `isWorkerAccount` 추가 확인 (이미 있음)
- [ ] `App.vue` NAV 분기 v-else → v-else-if="isFarmUser" 명시
- [ ] `App.vue` `roleResolved` computed + 로딩 스켈레톤 분기
- [ ] `style.css` 로딩 스켈레톤 + shimmer 애니메이션
- [ ] `App.vue` 모바일 햄버거 z-index/min-size 확인
- [ ] 라우트 변경 시 isDrawerOpen=false watch (없으면 추가)

### 7.3 검증
- [ ] vue-tsc EXIT 0
- [ ] iOS Safari 더블탭 확대 X 확인
- [ ] iOS Safari input 포커스 확대 X 확인
- [ ] Android Chrome 더블탭 확대 X 확인
- [ ] 차트 핀치줌 정상 확인
- [ ] farm_user 로그인 → 사이드바 즉시 표시
- [ ] 모든 role 회귀 확인

---

## 8. Open Questions

- [ ] `.allow-zoom` 을 어디까지 적용할지? (현재 안: Chart.js 컨테이너만 — 필요시 이미지 모달도)
- [ ] 로딩 스켈레톤 표시 임계값 (200ms 미만 생략) 도입 여부 — 1차는 단순 유지
- [ ] iOS standalone PWA 모드에서만 추가로 다른 처리 필요한지 — 1차는 일반 웹과 동일 처리

---

## 9. PDCA 다음

→ `/pdca do mobile-ux-hardening` — 위 7장 체크리스트 순서대로 구현
