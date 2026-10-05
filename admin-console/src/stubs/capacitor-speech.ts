/** 콘솔은 음성 어시스턴트를 포함하지 않는다(FEATURE_PARITY I1). 타입 호환용 스텁. */
const noopHandle = { remove: async () => undefined }
export const SpeechRecognition = {
  checkPermissions: async () => ({ speechRecognition: 'denied' as const }),
  requestPermissions: async () => ({ speechRecognition: 'denied' as const }),
  start: async (_opts?: unknown) => ({ matches: [] as string[] }),
  stop: async () => undefined,
  addListener: async (..._args: unknown[]) => noopHandle,
}
