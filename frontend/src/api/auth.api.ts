import apiClient from './client'
import type { LoginResponse, TokenResponse, User } from '../types/auth.types'

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', { username, password }),

  // 웹: 쿠키 자동 전송(body 없음). 앱: 저장된 refresh token 을 body 로 전달.
  refresh: (refreshToken?: string) =>
    apiClient.post<TokenResponse>('/auth/refresh', refreshToken ? { refreshToken } : undefined),

  logout: () =>
    apiClient.post('/auth/logout'),

  /** 만료된 refresh 쿠키 강제 정리 — public (no auth required) */
  clearCookie: () =>
    apiClient.post('/auth/clear-cookie'),

  me: () =>
    apiClient.get<User>('/auth/me'),
}
