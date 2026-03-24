export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string | null
  parentUserName?: string | null
  address?: string
  status: 'active' | 'inactive'
  tuyaProject?: TuyaProject
  createdAt: string
  updatedAt: string
}

export interface TuyaProject {
  id: string
  name: string
  accessId: string
  endpoint: string
  projectId?: string
  enabled: boolean
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string
}
