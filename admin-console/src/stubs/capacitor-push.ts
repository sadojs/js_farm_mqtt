/** 콘솔은 네이티브 푸시를 쓰지 않는다(웹 전용). 호출되어도 아무 일도 하지 않는 스텁. */
const noopHandle = { remove: async () => undefined }
export const PushNotifications = {
  checkPermissions: async () => ({ receive: 'denied' as const }),
  requestPermissions: async () => ({ receive: 'denied' as const }),
  register: async () => undefined,
  addListener: async (..._args: unknown[]) => noopHandle,
}
