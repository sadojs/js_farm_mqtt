<script setup lang="ts">
import { computed } from 'vue'
import type { FallbackMode, FallbackGatewayStatus, FallbackConfig } from '../../types/emergency-failover.types'

const props = defineProps<{
  mode: FallbackMode
  status: FallbackGatewayStatus | null
  config: FallbackConfig
}>()
defineEmits<{
  (e: 'resync'): void
  (e: 'emergency-stop'): void
}>()

const modeBadgeClass = computed(() => {
  switch (props.mode) {
    case 'online': return 'badge badge-online'
    case 'fallback': return 'badge badge-fallback'
    default: return 'badge badge-unknown'
  }
})
const modeLabel = computed(() => {
  switch (props.mode) {
    case 'online': return '🟢 ONLINE'
    case 'fallback': return '🔴 FALLBACK'
    default: return '⚪ UNKNOWN'
  }
})

function fmt(d: string | null | undefined) {
  if (!d) return '-'
  return new Date(d).toLocaleString('ko-KR', { hour12: false })
}
</script>

<template>
  <section class="status-card">
    <div class="status-row">
      <div>
        <span class="status-label">현재 모드</span>
        <span :class="modeBadgeClass">{{ modeLabel }}</span>
      </div>
      <div>
        <span class="status-label">버전</span>
        <span>v{{ config.version }}
          <small v-if="config.lastAppliedVersion === config.version" class="synced">
            ✅ 동기화됨 ({{ fmt(config.lastAppliedAt) }})
          </small>
          <small v-else-if="config.lastAppliedVersion != null" class="warn">
            🔄 동기화 중 (RPi v{{ config.lastAppliedVersion }} → v{{ config.version }})
          </small>
          <small v-else class="warn">⚠️ RPi 미동기화</small>
        </span>
      </div>
      <div>
        <span class="status-label">마지막 하트비트</span>
        <span>{{ fmt(status?.lastHeartbeatSeenAt) }}</span>
      </div>
      <div class="actions">
        <button class="btn-secondary" @click="$emit('resync')">재동기화</button>
        <button class="btn-danger" @click="$emit('emergency-stop')">비상 정지</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.status-card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.status-row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.status-row > div { display: flex; flex-direction: column; gap: 2px; }
.status-row .actions { margin-left: auto; flex-direction: row; gap: 8px; }
.status-label { font-size: 12px; color: var(--text-secondary, #888); }
.badge { padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 13px; display: inline-block; }
.badge-online { background: #e8f5e9; color: #2e7d32; }
.badge-fallback { background: #ffebee; color: #c62828; }
.badge-unknown { background: #eceff1; color: #546e7a; }
.warn { color: var(--warning, #f57c00); }
.synced { color: var(--success, #2e7d32); }
.btn-secondary, .btn-danger {
  padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px;
  border: 1px solid transparent;
}
.btn-secondary {
  background: var(--card-bg, #fff); color: var(--text, #333);
  border-color: var(--border-color, #ccc);
}
.btn-danger { background: var(--danger, #d32f2f); color: #fff; }
</style>
