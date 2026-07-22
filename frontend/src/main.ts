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
