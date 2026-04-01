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
    // 알림 센터에도 추가 (error/warning 는 항상, info/success는 메시지가 있을 때)
    if (type === 'error' || type === 'warning' || message) {
      addToCenter(type, title, message)
    }
    return id
  }

  function addToCenter(type: NotificationCenterItem['type'], title: string, message: string) {
    const item: NotificationCenterItem = {
      id: String(Date.now()) + String(Math.random()),
      type,
      title,
      message,
      read: false,
      createdAt: new Date(),
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
