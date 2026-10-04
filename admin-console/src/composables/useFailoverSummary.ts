/**
 * 게이트웨이별 페일오버 요약 (기존 emergencyFailoverApi.getFull 과 같은 엔드포인트, 플랫폼 범위).
 * 표시 규칙은 기존 FailoverStatusCard.vue 와 동일: lastAppliedVersion === version → 동기화됨.
 */
import { ref } from 'vue'
import apiClient from '@/api/client'
import type { FallbackFullConfig } from '@/types/emergency-failover.types'
import { PLATFORM_REQUEST } from '@console/farm/farmContext'

export interface FailoverSummary {
  mode: 'online' | 'fallback' | 'unknown'
  version: number | null
  appliedVersion: number | null
  sync: 'synced' | 'syncing' | 'never'
  lastHeartbeat: string | null
  heartbeatTimeoutSeconds: number | null
}

export function useFailoverSummary() {
  const byGatewayId = ref<Record<string, FailoverSummary>>({})

  async function load(gatewayIds: string[]) {
    const results = await Promise.allSettled(
      gatewayIds.map((gid) => apiClient.get<FallbackFullConfig>(`/fallback-config/${encodeURIComponent(gid)}`, PLATFORM_REQUEST)),
    )
    const next: Record<string, FailoverSummary> = {}
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return
      const { config, status } = r.value.data || ({} as FallbackFullConfig)
      const version = config?.version ?? null
      const applied = config?.lastAppliedVersion ?? null
      next[gatewayIds[i]] = {
        mode: (status?.mode as FailoverSummary['mode']) || 'unknown',
        version,
        appliedVersion: applied,
        sync: applied == null ? 'never' : applied === version ? 'synced' : 'syncing',
        lastHeartbeat: status?.lastHeartbeatSeenAt ?? null,
        heartbeatTimeoutSeconds: config?.heartbeatTimeoutSeconds ?? null,
      }
    })
    byGatewayId.value = next
  }

  return { byGatewayId, load }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
