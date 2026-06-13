export interface WorkTaskType {
  id: string
  userId: string
  label: string
  color: string
  emoji: string
  iconKey: string | null
  isStandard: boolean
  hidden: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export interface WorkLog {
  id: string
  userId: string
  zoneId: string
  taskTypeId: string
  workerId: string | null
  doneAt: string
  note: string | null
  qty: number | null
  createdAt: string
  updatedAt: string
}

export interface BoardCell {
  zoneId: string
  taskTypeId: string
  lastDoneAt: string
}

export interface UpsertTaskTypeDto {
  label: string
  color: string
  emoji: string
  iconKey?: string
  displayOrder?: number
}

export interface CreateLogDto {
  zoneId: string
  taskTypeId: string
  workerId?: string | null
  doneAt?: string
  note?: string
  qty?: number
}

export interface Palette {
  emoji: string[]
  color: string[]
}
