import apiClient from './client'
import type { LoginResponse, TokenResponse, User } from '../types/auth.types'

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', { username, password }),

  // 쿠키는 브라우저가 자동 전송 → body 없음
  refresh: () =>
    apiClient.post<TokenResponse>('/auth/refresh'),

  logout: () =>
    apiClient.post('/auth/logout'),

  /** 만료된 refresh 쿠키 강제 정리 — public (no auth required) */
  clearCookie: () =>
    apiClient.post('/auth/clear-cookie'),

  me: () =>
    apiClient.get<User>('/auth/me'),
}
