// 방재일정 관리 타입

/** 약종(해충) 색 프리셋 — 확장 가능 */
export const PEST_COLOR_PRESETS: { label: string; color: string }[] = [
  { label: '총채약', color: '#e53935' },
  { label: '진딧물약', color: '#8e24aa' },
  { label: '응애약', color: '#fb8c00' },
  { label: '역병약', color: '#1e88e5' },
  { label: '나방약', color: '#00897b' },
  { label: '기타', color: '#607d8b' },
]

/** 구역 구분색 프리셋 */
export const ZONE_COLOR_PRESETS: string[] = [
  '#43a047',
  '#1e88e5',
  '#8e24aa',
  '#fb8c00',
  '#00897b',
  '#5e35b1',
]

export interface SprayProduct {
  id?: string
  rank: number
  name: string
  startDate: string
  intervalDays: number
  count: number
}

export interface SprayProgram {
  id?: string
  pest: string
  color: string
  sortOrder?: number
  products: SprayProduct[]
}

export interface SprayZone {
  id: string
  groupId: string | null
  name: string
  cropType: string | null
  transplantDate: string
  color: string
  sortOrder: number
  isActive: boolean
  programs: SprayProgram[]
}

export interface SaveZonePayload {
  id?: string
  groupId?: string
  name: string
  cropType?: string
  transplantDate: string
  color?: string
  sortOrder?: number
  programs: SprayProgram[]
}

export interface SprayEvent {
  id: string
  zoneId: string
  programId: string | null
  productId: string | null
  date: string
  pest: string | null
  product: string | null
  color: string | null
  round: number
  isManual: boolean
  pinned: boolean
  note: string | null
  zoneName: string | null
  zoneColor: string | null
}

export interface ZoneMarker {
  id: string
  name: string
  color: string
  transplantDate: string
}

export interface CreateManualEventPayload {
  zoneId: string
  date: string
  pest?: string
  product?: string
  color?: string
  note?: string
}

export type MoveMode = 'single' | 'following'
