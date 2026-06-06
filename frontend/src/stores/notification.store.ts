import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  timeout?: number
}

// 알림 센터용 항목 (영구 보관, 읽음 상태 관리)
export interface NotificationCenterItem {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  read: boolean
  createdAt: Date
}

export const useNotificationStore = defineStore('notification', () => {
  // 토스트 알림 (일시적)
  const notifications = ref<Notification[]>([])

  // 알림 센터 아이템 (영구적, 최대 50건)
  const centerItems = ref<NotificationCenterItem[]>([])

  const unreadCount = computed(() => centerItems.value.filter(n => !n.read).length)

  let nextId = 0

  function add(type: Notification['type'], title: string, message: string, timeout = 5000) {
    const id = String(++nextId)
    notifications.value.push({ id, type, title, message, timeout })
    if (timeout > 0) {
      setTimeout(() => remove(id), timeout)
    }
    // 알림 센터는 실제 "상태/문제"가 있을 때만 보관한다.
    // success/info 는 토스트 1회로 끝 — 사용자가 다시 보거나 추적할 필요 없음.
    // error/warning 만 영구 보관.
    if (type === 'error' || type === 'warning') {
      addToCenter(type, title, message)
    }
    return id
  }

  // 중복 알림 차단 — 같은 type+title+message가 60초 내에 이미 있으면 새로 추가하지 않는다.
  const CENTER_DEDUP_WINDOW_MS = 60_000

  function addToCenter(type: NotificationCenterItem['type'], title: string, message: string) {
    const now = Date.now()
    const recent = centerItems.value.find(
      n => n.type === type && n.title === title && n.message === message
        && (now - n.createdAt.getTime()) < CENTER_DEDUP_WINDOW_MS,
    )
    if (recent) {
      // 같은 알림 — 발생 시각만 최신화하고 읽지 않음 상태로 되돌림
      recent.createdAt = new Date(now)
      recent.read = false
      return
    }
    const item: NotificationCenterItem = {
      id: String(now) + String(Math.random()),
      type,
      title,
      message,
      read: false,
      createdAt: new Date(now),
    }
    centerItems.value.unshift(item)
    // 최대 50건 유지
    if (centerItems.value.length > 50) {
      centerItems.value = centerItems.value.slice(0, 50)
    }
  }

  function remove(id: string) {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  function markAllRead() {
    centerItems.value.forEach(n => { n.read = true })
  }

  function removeCenterItem(id: string) {
    centerItems.value = centerItems.value.filter(n => n.id !== id)
  }

  function clearCenter() {
    centerItems.value = []
  }

  function success(title: string, message = '') {
    return add('success', title, message, 3000)
  }

  function error(title: string, message = '') {
    return add('error', title, message, 8000)
  }

  function warning(title: string, message = '') {
    return add('warning', title, message, 6000)
  }

  function info(title: string, message = '') {
    return add('info', title, message)
  }

  return {
    notifications,
    centerItems,
    unreadCount,
    add,
    addToCenter,
    remove,
    markAllRead,
    removeCenterItem,
    clearCenter,
    success,
    error,
    warning,
    info,
  }
})
