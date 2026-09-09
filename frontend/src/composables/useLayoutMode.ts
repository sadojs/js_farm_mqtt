/**
 * useLayoutMode — 레이아웃 모드 판정 + 사용자 오버라이드
 *
 * 저장: localStorage['sf-layout-mode']  (기존 sf-theme / sf-font-size 와 동일 패턴)
 *
 * 판정 순서
 *   1. 화면폭 ≤ 768px  → 항상 'mobile' (설정 무시 — 사이드바 260px 가 물리적으로 안 들어감)
 *   2. pref 'tablet'   → 'tablet'
 *   3. pref 'desktop'  → 'desktop'
 *   4. pref 'auto'     → 769~1366px 'tablet' / 1367px+ 'desktop'
 *
 * auto 상한 1366px 근거: iPad Pro 12.9" 가로(1366)까지 태블릿으로 잡고
 * 일반 노트북(1440+)은 데스크탑으로 남긴다.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

export type LayoutPref = 'auto' | 'tablet' | 'desktop'
export type LayoutMode = 'mobile' | 'tablet' | 'desktop'

const STORAGE_KEY = 'sf-layout-mode'
const MOBILE_MAX = 768
const TABLET_MAX = 1366

function readPref(): LayoutPref {
  if (typeof window === 'undefined') return 'auto'
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'tablet' || v === 'desktop' || v === 'auto' ? v : 'auto'
}

// 모듈 스코프 — 여러 컴포넌트가 같은 상태를 공유
const pref = ref<LayoutPref>(readPref())
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)

export function resolveMode(p: LayoutPref, w: number): LayoutMode {
  if (w <= MOBILE_MAX) return 'mobile'
  if (p === 'tablet') return 'tablet'
  if (p === 'desktop') return 'desktop'
  return w <= TABLET_MAX ? 'tablet' : 'desktop'
}

export function useLayoutMode() {
  const mode = computed<LayoutMode>(() => resolveMode(pref.value, viewportWidth.value))

  // 태블릿 모드는 구역 관리를 시작 페이지로 (하우스 고정 기기 용도)
  const defaultRoute = computed(() => (mode.value === 'tablet' ? '/groups' : '/dashboard'))

  // 사이드바가 없는 모드 — 드로어를 쓴다
  const usesDrawer = computed(() => mode.value === 'mobile' || mode.value === 'tablet')

  function setPref(p: LayoutPref) {
    pref.value = p
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, p)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  function onResize() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { viewportWidth.value = window.innerWidth }, 150)
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    viewportWidth.value = window.innerWidth
    window.addEventListener('resize', onResize)
  })

  onUnmounted(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('resize', onResize)
    if (timer) clearTimeout(timer)
  })

  return { pref, setPref, mode, defaultRoute, usesDrawer, viewportWidth }
}
