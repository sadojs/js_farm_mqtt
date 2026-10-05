export interface User {
  id: string
  username: string
  name: string
  role: 'admin' | 'farm_admin' | 'farm_user'
  parentUserId?: string | null
  parentUserName?: string | null
  /** 소속 농장 이름 (사용자 목록 API — 농장 사용자의 부모 농장) */
  parentFarmName?: string | null
  address?: string
  /**
   * 농장 이름. 사용자 목록 API: 농장 관리자 본인 값(그 외 null).
   * 로그인·/auth/me: 내가 속한 농장 이름(농장 관리자=자기 농장, 농장 사용자=소속 농장)
   */
  farmName?: string | null
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
