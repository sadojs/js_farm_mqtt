<template>
  <div class="c-auth">
    <form class="c-auth-card c-card" @submit.prevent="submit">
      <div class="c-auth-brand">
        <div class="c-logo"><CIcon name="leaf" /></div>
        <div><b>스마트팜 콘솔</b><span>플랫폼 관리자 전용</span></div>
      </div>
      <div class="c-form-row">
        <label for="c-login-id">아이디</label>
        <input id="c-login-id" v-model.trim="username" class="c-input" autocomplete="username" required autofocus />
      </div>
      <div class="c-form-row">
        <label for="c-login-pw">비밀번호</label>
        <input id="c-login-pw" v-model="password" class="c-input" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="c-auth-err" role="alert">{{ error }}</p>
      <button class="c-btn c-btn-pri c-auth-submit" type="submit" :disabled="auth.loading || !username || !password">
        {{ auth.loading ? '로그인 중…' : '로그인' }}
      </button>
      <p class="c-auth-note">농장 관리자·농장 사용자는 <a :href="legacyAppUrl">기존 앱</a>을 이용하세요.</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import CIcon from '@console/components/CIcon.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const legacyAppUrl = computed(() => (location.port === '5175' ? `https://${location.hostname}:5174/` : `${location.protocol}//${location.hostname}:8443/`))

async function submit() {
  error.value = ''
  try {
    await auth.login(username.value, password.value)
    password.value = ''
    if (!auth.isAdmin) return router.replace('/blocked')
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    await router.replace(auth.user?.mustChangePassword ? '/change-password' : redirect)
  } catch (e: any) {
    const status = e?.response?.status
    error.value = status === 429
      ? '로그인 시도가 너무 많습니다. 1분 후 다시 시도하세요.'
      : e?.response?.data?.message || '아이디 또는 비밀번호를 확인하세요.'
  }
}
</script>

<style scoped>
.c-auth { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--c-bg); padding: 16px; font-family: var(--c-font); color: var(--c-text); }
.c-auth-card { width: min(380px, 100%); padding: 28px; display: flex; flex-direction: column; gap: 14px; }
.c-auth-brand { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.c-auth-brand b { display: block; font-size: 16px; }
.c-auth-brand span { font-size: 12px; color: var(--c-text-muted); }
.c-auth-submit { justify-content: center; height: 40px; }
.c-auth-err { margin: 0; color: var(--c-bad-fg); background: var(--c-bad-bg); padding: 8px 10px; border-radius: var(--c-radius-sm); font-size: 13px; }
.c-auth-note { margin: 0; font-size: 12px; color: var(--c-text-muted); text-align: center; }
.c-input { width: 100%; height: 40px; font-size: 14px; }
</style>
