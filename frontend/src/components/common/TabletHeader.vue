<script setup lang="ts">
/**
 * TabletHeader — 태블릿 모드 전용 상단 헤더 (62px)
 *
 * 사이드바가 사라지므로 "지금 어느 페이지인지" + "데이터가 최신인지" 를 여기서 알려준다.
 * 좌 → 우: 햄버거 · 페이지명 · 위치 · spacer · 연결상태 · 알림 · 환경설정
 *
 * 페이지명은 route.meta.title 사용. 없는 라우트는 router/index.ts 에 meta.title 추가 필요.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NotificationCenter from './NotificationCenter.vue'

interface Props {
  /** 농장/구역 위치 라벨 — 없으면 구분선까지 숨김 */
  locationLabel?: string
  /** 연결 상태 — 상위에서 WebSocket/onLine 종합해 넘김 */
  connected?: boolean
  /** 마지막 데이터 수신 상대시각 (예: '방금', '2분 전') */
  lastSeenLabel?: string
}
withDefaults(defineProps<Props>(), {
  locationLabel: '',
  connected: true,
  lastSeenLabel: '방금',
})

defineEmits<{
  'open-drawer': []
  'open-settings': []
}>()

const route = useRoute()
const pageTitle = computed(() => (route.meta?.title as string) ?? '')
</script>

<template>
  <header class="tablet-header">
    <button class="burger" @click="$emit('open-drawer')" aria-label="메뉴 열기">
      <span></span><span></span><span></span>
    </button>

    <span class="th-title">{{ pageTitle }}</span>
    <span v-if="locationLabel" class="th-loc">{{ locationLabel }}</span>

    <span class="th-grow"></span>

    <div class="th-conn" :class="{ off: !connected }">
      <i></i>
      <span>{{ connected ? `연결됨 · ${lastSeenLabel}` : '연결 끊김' }}</span>
    </div>

    <NotificationCenter />

    <button class="th-btn" @click="$emit('open-settings')" aria-label="환경설정" title="환경설정">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </header>
</template>

<style scoped>
.tablet-header {
  display: flex;
  align-items: center;
  gap: 13px;
  height: 62px;
  padding: 0 18px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  padding-top: env(safe-area-inset-top, 0px);
}

.burger {
  width: 48px;
  height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 10px);
  cursor: pointer;
  flex-shrink: 0;
}
.burger span {
  display: block;
  width: 21px;
  height: 2px;
  background: var(--text-primary);
  border-radius: 1px;
}
.burger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.th-title {
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.th-loc {
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-muted);
  padding-left: 11px;
  border-left: 1px solid var(--border-color);
  white-space: nowrap;
}

.th-grow { flex: 1; }

.th-conn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px;
  background: var(--accent-bg);
  border-radius: var(--radius-pill, 999px);
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}
.th-conn i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success, #4caf50);
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.2);
}
.th-conn.off {
  background: var(--danger-bg);
  color: var(--danger);
}
.th-conn.off i {
  background: var(--danger);
  box-shadow: 0 0 0 3px rgba(229, 57, 53, 0.2);
}

.th-btn {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 10px);
  cursor: pointer;
  flex-shrink: 0;
}
.th-btn svg {
  width: 21px;
  height: 21px;
  color: var(--text-secondary);
}
.th-btn:hover {
  background: var(--bg-hover);
}
.th-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
