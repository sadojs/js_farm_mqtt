import apiClient from './client'
import type { User } from '../types/auth.types'

export interface CreateUserRequest {
  email: string
  password: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  address?: string
  parentUserId?: string
}

export interface UpdateTuyaRequest {
  name: string
  accessId: string
  accessSecret: string
  endpoint: string
  projectId?: string
  enabled?: boolean
}

export const userApi = {
  // 자기 정보 수정 (모든 사용자)
  updateMe: (data: { name?: string; address?: string; password?: string }) =>
    apiClient.put<User>('/users/me', data),

  updateMyTuya: (data: UpdateTuyaRequest) =>
    apiClient.put('/users/me/tuya', data),

  // 관리자 전용
  getAll: () =>
    apiClient.get<User[]>('/users'),

  getFarmAdmins: () =>
    apiClient.get('/users/farm-admins'),

  getById: (id: string) =>
    apiClient.get<User>(`/users/${id}`),

  create: (data: CreateUserRequest) =>
    apiClient.post<User>('/users', data),

  update: (id: string, data: Partial<CreateUserRequest>) =>
    apiClient.put<User>(`/users/${id}`, data),

  remove: (id: string) =>
    apiClient.delete(`/users/${id}`),

  updateTuya: (id: string, data: UpdateTuyaRequest) =>
    apiClient.put(`/users/${id}/tuya`, data),

  // Tuya 연결 테스트 (폼 데이터로 직접 테스트)
  testTuyaConnection: (data: { accessId: string; accessSecret: string; endpoint: string }) =>
    apiClient.post('/tuya/test-connection', data),
}
