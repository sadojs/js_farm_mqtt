export interface User {
  id: string
  username: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string | null
  parentUserName?: string | null
  address?: string
  status: 'active' | 'inactive'
  mustChangePassword?: boolean
  createdAt: string
  updatedAt: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  // 앱(Capacitor)에서만 내려옴 — 웹은 httpOnly 쿠키로 처리하므로 미포함
  refreshToken?: string
  user: User
}

export interface TokenResponse {
  accessToken: string
  // 앱에서만 내려옴 (웹은 쿠키)
  refreshToken?: string
}
