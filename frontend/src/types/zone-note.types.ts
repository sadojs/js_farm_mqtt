export type ZoneNoteTag = 'water' | 'nutrient' | 'pest' | 'env' | 'etc'

export interface ZoneNote {
  id: string
  userId: string
  zoneId: string
  tag: ZoneNoteTag
  text: string
  pinned: boolean
  createdByUser: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateZoneNotePayload {
  zoneId: string
  tag: ZoneNoteTag
  text: string
  pinned?: boolean
}

export interface UpdateZoneNotePayload {
  tag?: ZoneNoteTag
  text?: string
  pinned?: boolean
}

export interface ZoneNoteTagMeta {
  key: ZoneNoteTag
  label: string
  color: string
  bg: string
  emoji: string
}

/** 태그 색 — PROMPT §4 */
export const ZONE_NOTE_TAGS: ZoneNoteTagMeta[] = [
  { key: 'water', label: '관수', color: '#00bcd4', bg: '#e0f7fa', emoji: '💧' },
  { key: 'nutrient', label: '양분', color: '#2e7d32', bg: '#e8f5e9', emoji: '🌱' },
  { key: 'pest', label: '병해', color: '#c62828', bg: '#ffebee', emoji: '🐛' },
  { key: 'env', label: '환경', color: '#1565c0', bg: '#e3f2fd', emoji: '🌡️' },
  { key: 'etc', label: '기타', color: '#607d8b', bg: '#eceff1', emoji: '📌' },
]

export function zoneNoteTagMeta(tag: ZoneNoteTag): ZoneNoteTagMeta {
  return ZONE_NOTE_TAGS.find((t) => t.key === tag) ?? ZONE_NOTE_TAGS[4]
}
