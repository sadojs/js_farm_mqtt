<template>
  <span class="badge" :class="cls">
    <span class="dot" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RemoteConfigStatus } from '../../api/config-deploy.api'

const props = defineProps<{
  status: RemoteConfigStatus | 'idle'
  detail?: string
}>()

const label = computed(() => {
  switch (props.status) {
    case 'idle':                return '대기'
    case 'pending':             return '적용중'
    case 'success':             return '완료'
    case 'applied_online':      return '완료 (온라인)'
    case 'applied_no_internet': return '적용됨 (인터넷 없음)'
    case 'rolled_back':         return '롤백됨'
    case 'failed':              return '실패'
    default:                    return String(props.status)
  }
})

const cls = computed(() => {
  switch (props.status) {
    case 'pending':             return 'badge--pending'
    case 'success':
    case 'applied_online':      return 'badge--ok'
    case 'applied_no_internet': return 'badge--warn'
    case 'rolled_back':
    case 'failed':              return 'badge--err'
    default:                    return 'badge--idle'
  }
})
</script>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  border: 1px solid currentColor;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.badge--idle    { color: var(--color-text-secondary, #888); }
.badge--pending { color: #2b6cb0; animation: pulse 1.4s ease-in-out infinite; }
.badge--ok      { color: #2f855a; }
.badge--warn    { color: #b7791f; }
.badge--err     { color: #c53030; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
</style>
