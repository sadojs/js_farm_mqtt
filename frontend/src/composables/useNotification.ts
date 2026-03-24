import { useNotificationStore } from '../stores/notification.store'

export function useNotification() {
  const store = useNotificationStore()

  return {
    notifications: store.notifications,
    success: store.success,
    error: store.error,
    warning: store.warning,
    info: store.info,
    remove: store.remove,
  }
}
