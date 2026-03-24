import apiClient from './client'
import type { LoginResponse, TokenResponse, User } from '../types/auth.types'

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', { email, password }),

  refresh: (refreshToken: string) =>
    apiClient.post<TokenResponse>('/auth/refresh', { refreshToken }),

  me: () =>
    apiClient.get<User>('/auth/me'),
}
