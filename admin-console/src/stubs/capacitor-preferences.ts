/** 웹 전용 스텁 — 기존 appAuth 는 네이티브에서만 사용하므로 콘솔에서는 호출돼도 아무것도 저장하지 않는다. */
export const Preferences = {
  get: async (_opts: { key: string }) => ({ value: null as string | null }),
  set: async (_opts: { key: string; value: string }) => undefined,
  remove: async (_opts: { key: string }) => undefined,
}
