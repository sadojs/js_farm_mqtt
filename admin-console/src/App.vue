<template>
  <ConsoleShell v-if="showShell" />
  <router-view v-else />
  <!-- 기존 앱의 전역 토스트·확인 다이얼로그 (기존 화면·콘솔 모두 사용) -->
  <ConfirmDialog />
  <ToastContainer />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { useWebSocket } from '@/composables/useWebSocket'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToastContainer from '@/components/common/ToastContainer.vue'
import ConsoleShell from '@console/layouts/ConsoleShell.vue'
import { hookFarmSocket, unhookFarmSocket } from '@console/farm/farmContext'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ws = useWebSocket()

const isConsoleUser = computed(() => auth.isAuthenticated && auth.isAdmin)
const showShell = computed(() =>
  isConsoleUser.value && !!route.meta.section && route.meta.section !== 'bare' && !route.meta.public,
)

// 실시간 소켓: 관리자 로그인 상태에서만 연결 (A7)
watch(isConsoleUser, (ok) => {
  if (ok) {
    ws.connect()
    hookFarmSocket(ws)
  } else {
    unhookFarmSocket()
    ws.disconnect()
  }
}, { immediate: true })

// 세션 만료(무음 갱신 실패 등) → 로그인 화면으로 (기존 앱과 동일한 안전장치)
watch(() => auth.isAuthenticated, (authed) => {
  if (!authed && !route.meta.public) router.replace('/login')
})
</script>
