<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="logo">🌱</div>
        <h1>스마트 농업 플랫폼</h1>
        <p>IoT 기반 농업 자동화 시스템</p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="email">이메일</label>
          <input
            id="email"
            v-model="loginData.email"
            type="email"
            name="email"
            autocomplete="email"
            placeholder="your@email.com"
            class="form-input"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">비밀번호</label>
          <input
            id="password"
            v-model="loginData.password"
            type="password"
            name="password"
            autocomplete="current-password"
            placeholder="비밀번호를 입력하세요"
            class="form-input"
            required
          />
        </div>

        <div class="form-options">
          <label class="checkbox-label">
            <input v-model="loginData.remember" type="checkbox" />
            <span>로그인 상태 유지</span>
          </label>
          <a href="#" class="forgot-password">비밀번호 찾기</a>
        </div>

        <button type="submit" class="btn-login" :disabled="isLoading">
          {{ isLoading ? '로그인 중...' : '로그인' }}
        </button>

        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>
      </form>

      <div class="login-footer">
        <p>관리자에게 계정 발급을 요청하세요</p>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.store'
import { useNotificationStore } from '../stores/notification.store'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()

interface LoginData {
  email: string
  password: string
  remember: boolean
}

const loginData = ref<LoginData>({
  email: '',
  password: '',
  remember: false
})

const isLoading = ref(false)
const errorMessage = ref('')

const handleLogin = async () => {
  isLoading.value = true
  errorMessage.value = ''

  try {
    await authStore.login(loginData.value.email, loginData.value.password)
    notificationStore.success('로그인 성공', `${authStore.user?.name}님 환영합니다.`)
    router.push('/dashboard')
  } catch (err: any) {
    errorMessage.value = err.response?.data?.message || '이메일 또는 비밀번호가 올바르지 않습니다.'
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
  gap: 24px;
}

.login-card {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 440px;
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo {
  font-size: 64px;
  margin-bottom: 16px;
}

.login-header h1 {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.login-header p {
  font-size: 14px;
  color: var(--text-link);
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.form-input {
  padding: 12px 16px;
  border: 2px solid var(--border-input);
  border-radius: 8px;
  font-size: 15px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input:focus-visible {
  outline: 2px solid #4caf50;
  outline-offset: 2px;
  border-color: #4caf50;
}

.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-link);
}

.checkbox-label input[type="checkbox"] {
  cursor: pointer;
}

.forgot-password {
  color: #4caf50;
  text-decoration: none;
  font-weight: 500;
}

.forgot-password:hover {
  text-decoration: underline;
}

.btn-login {
  padding: 14px;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s, box-shadow 0.2s;
}

.btn-login:focus-visible {
  outline: 2px solid #2e7d32;
  outline-offset: 2px;
}

.btn-login:hover:not(:disabled) {
  background: #45a049;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
}

.btn-login:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  padding: 12px;
  background: #ffebee;
  color: #c62828;
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-input);
}

.login-footer p {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

@media (max-width: 480px) {
  .login-card {
    padding: 30px 24px;
  }

  .login-header h1 {
    font-size: 24px;
  }
}
</style>
