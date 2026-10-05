<template>
  <div class="c-auth">
    <div class="c-card c-blocked" role="alert">
      <div class="c-ico" style="background:var(--c-warn-bg);color:var(--c-warn-fg);width:40px;height:40px"><CIcon name="warn" :size="20" /></div>
      <h1 class="c-h1">플랫폼 관리자 전용</h1>
      <p class="c-sub">
        <b>{{ auth.user?.name }}</b> (@{{ auth.user?.username }}) 계정은 {{ roleLabel }} 계정입니다.<br />
        이 콘솔은 플랫폼 관리자만 사용할 수 있습니다. 농장 관리·제어는 기존 앱에서 그대로 이용하세요.
      </p>
      <div class="c-actions" style="justify-content:center">
        <a class="c-btn c-btn-pri" :href="legacyAppUrl">기존 앱으로 이동</a>
        <button class="c-btn" type="button" @click="logout">로그아웃</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import CIcon from '@console/components/CIcon.vue'

const auth = useAuthStore()
const router = useRouter()
const roleLabel = computed(() => (auth.user?.role === 'farm_admin' ? '농장 관리자' : auth.user?.role === 'farm_user' ? '농장 사용자' : '일반'))
const legacyAppUrl = computed(() => (location.port === '5175' ? `https://${location.hostname}:5174/` : `${location.protocol}//${location.hostname}:8443/`))

async function logout() {
  await auth.logout()
  await router.replace('/login')
}
</script>

<style scoped>
.c-auth { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--c-bg); padding: 16px; font-family: var(--c-font); color: var(--c-text); }
.c-blocked { width: min(460px, 100%); padding: 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.c-blocked .c-sub { line-height: 1.6; }
</style>
