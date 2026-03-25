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

export const userApi = {
  updateMe: (data: { name?: string; address?: string; password?: string }) =>
    apiClient.put<User>('/users/me', data),

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
}
