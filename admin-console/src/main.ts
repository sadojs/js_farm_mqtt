import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installFarmContext, storeSnapshotPlugin } from './farm/farmContext'
// 기존 화면(임베드)이 쓰는 전역 CSS 변수·기본 규칙 — 그대로 사용(수정 금지)
import '@/style.css'
// 콘솔 셸·신규 화면 스타일 (c-* / --c-* 접두사로 기존 CSS 와 분리)
import './styles/console.css'
import './styles/legacy-theme.css'

async function bootstrap() {
  const app = createApp(App)
  const pinia = createPinia()
  pinia.use(storeSnapshotPlugin) // 농장 전환 시 기존 스토어 초기화용 스냅샷
  app.use(pinia)

  // 기존 auth 스토어 그대로 사용: refresh 쿠키로 세션 복원(A2) + 10분 무음 갱신(A3)
  const { useAuthStore } = await import('@/stores/auth.store')
  await useAuthStore().initAuth()

  installFarmContext(router, pinia) // X-Farm-Context 인터셉터 + 소켓 farm room + 스토어 초기화
  app.use(router)
  app.mount('#app-root')
}

bootstrap()
