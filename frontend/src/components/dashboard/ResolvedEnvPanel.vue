<template>
  <div class="resolved-env-panel">
    <!-- 내부 환경 섹션 -->
    <div v-if="internalItems.length > 0" class="env-section">
      <h4 class="env-section-title">내부 환경</h4>
      <div class="env-grid">
        <div v-for="[key, item] in internalItems" :key="key" class="env-item">
          <span class="env-icon">{{ ROLE_ICONS[key] ?? '📊' }}</span>
          <div class="env-info">
            <span class="env-label">{{ item.label }}</span>
            <span :class="['env-value', item.source === '미설정' ? 'unmapped' : '']">
              {{ formatValue(item) }}
              <span v-if="item.value !== null && item.source !== '미설정'" class="env-unit">{{ item.unit }}</span>
            </span>
          </div>
          <span class="env-source">{{ item.source }}</span>
        </div>
      </div>
    </div>

    <!-- 외부 환경 섹션 -->
    <div v-if="externalItems.length > 0" class="env-section">
      <h4 class="env-section-title">외부 환경</h4>
      <div class="env-grid">
        <div v-for="[key, item] in externalItems" :key="key" class="env-item">
          <span class="env-icon">{{ ROLE_ICONS[key] ?? '📊' }}</span>
          <div class="env-info">
            <span class="env-label">{{ item.label }}</span>
            <span :class="['env-value', item.source === '미설정' ? 'unmapped' : '']">
              {{ formatValue(item) }}
              <span v-if="item.value !== null && item.source !== '미설정'" class="env-unit">{{ item.unit }}</span>
            </span>
          </div>
          <span class="env-source">{{ item.source }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ResolvedValue } from '@/api/env-config.api'

const props = defineProps<{ resolved: Record<string, ResolvedValue> }>()

const ROLE_ICONS: Record<string, string> = {
  internal_temp: '🌡',
  internal_humidity: '💧',
  co2: '🌫',
  uv: '☀️',
  rainfall: '🌧',
  external_temp: '🌡',
  external_humidity: '💧',
  wind_speed: '💨',
}

const internalItems = computed(() =>
  Object.entries(props.resolved).filter(([, v]) => v.category === 'internal')
)
const externalItems = computed(() =>
  Object.entries(props.resolved).filter(([, v]) => v.category === 'external')
)

function formatValue(item: ResolvedValue): string {
  if (item.source === '미설정') return '미설정'
  if (item.value === null) return '—'
  const n = Number(item.value)
  if (item.unit === 'ppm') return Math.round(n).toLocaleString()
  return n.toFixed(1)
}
</script>

<style scoped>
.resolved-env-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px 0;
}

.env-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.env-section-title {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-light, var(--border-color));
}

.env-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary, var(--bg-hover));
  border-radius: 10px;
  border: 1px solid var(--border-light, transparent);
}

.env-icon {
  font-size: 22px;
  flex-shrink: 0;
  width: 28px;
  text-align: center;
}

.env-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.env-label {
  font-size: calc(12px * var(--content-scale, 1));
  color: var(--text-muted);
  font-weight: 500;
  white-space: nowrap;
}

.env-value {
  font-size: calc(20px * var(--content-scale, 1));
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.env-value.unmapped {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 400;
  color: var(--text-muted);
}

.env-unit {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 2px;
}

.env-source {
  font-size: calc(11px * var(--content-scale, 1));
  color: var(--text-muted);
  text-align: right;
  flex-shrink: 0;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .env-grid {
    grid-template-columns: 1fr;
  }
}
</style>
