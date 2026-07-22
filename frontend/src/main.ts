import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

// Vite 동적 import preload 실패(재배포로 예전 청크가 사라짐) → 최신 빌드로 한 번 리로드해 복구.
// (router.onError 로 못 잡히는 preload 단계 실패 대비. 세션당 1회 가드 공유.)
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('chunk-reload-attempt')) return
  sessionStorage.setItem('chunk-reload-attempt', '1')
  ;(e as Event).preventDefault?.()
  window.location.reload()
})

// 새 배포 자동 적용 — 이미 서비스워커가 제어 중인 '재방문' 상태에서 새 SW가 제어권을
// 넘겨받으면(=새 버전 배포·활성화) 최신 코드로 1회 리로드한다. (모바일에서 예전 캐시
// 빌드가 계속 실행돼 수정이 반영 안 되던 문제 완화. 첫 설치 시엔 리로드 안 함.)
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let swReloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading) return
    swReloading = true
    window.location.reload()
  })
}

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  const { useAuthStore } = await import('./stores/auth.store')
  await useAuthStore().initAuth()

  app.use(router)
  app.mount('#vue-root')
}

bootstrap()
