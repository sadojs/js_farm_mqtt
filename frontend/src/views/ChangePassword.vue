<template>
  <div class="cp-container">
    <div class="cp-card">
      <div class="cp-header">
        <div class="cp-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h1>비밀번호 변경</h1>
        <p class="cp-sub">처음 로그인하셨습니다. 임시 비밀번호를 본인만 아는 새 비밀번호로 변경해 주세요.</p>
      </div>

      <form class="cp-form" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="newpw">새 비밀번호</label>
          <input
            id="newpw"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="6자 이상"
            class="form-input"
            required
          />
        </div>
        <div class="form-group">
          <label for="confirmpw">새 비밀번호 확인</label>
          <input
            id="confirmpw"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="새 비밀번호 다시 입력"
            class="form-input"
            required
          />
        </div>

        <p v-if="errorMessage" class="cp-error">{{ errorMessage }}</p>

        <button type="submit" class="cp-submit" :disabled="isLoading">
          {{ isLoading ? '변경 중…' : '비밀번호 변경하고 계속' }}
        </button>
      </form>

      <button class="cp-logout" @click="handleLogout">로그아웃</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import apiClient from '../api/client'
import { useAuthStore } from '../stores/auth.store'

const router = useRouter()
const authStore = useAuthStore()

const newPassword = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

async function handleSubmit() {
  errorMessage.value = ''
  if (newPassword.value.length < 6) {
    errorMessage.value = '비밀번호는 6자 이상이어야 합니다.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = '새 비밀번호가 일치하지 않습니다.'
    return
  }
  isLoading.value = true
  try {
    await apiClient.put('/users/me', { password: newPassword.value })
    // 변경 후 사용자 정보 갱신 → mustChangePassword 해제
    await authStore.fetchUser()
    // 적절한 홈으로 이동 (가드가 역할별 목적지로 라우팅)
    router.push('/')
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.message || '비밀번호 변경에 실패했습니다.'
  } finally {
    isLoading.value = false
  }
}

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.cp-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  padding: 20px;
}
.cp-card {
  width: 100%;
  max-width: 420px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.cp-header { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cp-icon {
  width: 56px; height: 56px; border-radius: 14px;
  background: var(--accent-bg); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.cp-icon svg { width: 28px; height: 28px; }
.cp-header h1 { font-size: var(--font-size-title); font-weight: 800; color: var(--text-primary); }
.cp-sub { color: var(--text-muted); font-size: var(--font-size-label); line-height: 1.5; }
.cp-form { display: flex; flex-direction: column; gap: 14px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-secondary); }
.form-input {
  padding: 12px 14px;
  border: 1px solid var(--border-input);
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  box-sizing: border-box;
  width: 100%;
}
.form-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cp-error {
  color: var(--danger);
  font-size: var(--font-size-caption);
  background: var(--danger-bg);
  border-radius: 8px;
  padding: 8px 12px;
}
.cp-submit {
  min-height: 48px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-weight: 700;
  font-size: var(--font-size-body);
  cursor: pointer;
}
.cp-submit:hover { background: var(--accent-hover); }
.cp-submit:disabled { opacity: 0.6; cursor: default; }
.cp-logout {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--font-size-caption);
  align-self: center;
}
.cp-logout:hover { color: var(--text-secondary); }
</style>
