import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  timeout?: number
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([])

  let nextId = 0

  function add(type: Notification['type'], title: string, message: string, timeout = 5000) {
    const id = String(++nextId)
    notifications.value.push({ id, type, title, message, timeout })
    if (timeout > 0) {
      setTimeout(() => remove(id), timeout)
    }
    return id
  }

  function remove(id: string) {
    notifications.value = notifications.value.filter(n => n.id !== id)
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
    add,
    remove,
    success,
    error,
    warning,
    info,
  }
})
