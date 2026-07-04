import { ref, computed, onMounted, onUnmounted } from 'vue'
import { emergencyFailoverApi } from '../api/emergency-failover.api'
import { onFallbackModeChanged, onFallbackEvent } from './useWebSocket'
import type {
  FallbackFullConfig,
  UpdateConfigDto,
  UpsertScheduleDto,
  FallbackEvent,
} from '../types/emergency-failover.types'

export function useEmergencyFailover() {
  const gatewayId = ref<string | null>(null)
  const full = ref<FallbackFullConfig | null>(null)
  const events = ref<FallbackEvent[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const config = computed(() => full.value?.config ?? null)
  const schedule = computed(() => full.value?.schedule ?? [])
  const status = computed(() => full.value?.status ?? null)
  const mode = computed(() => status.value?.mode ?? 'unknown')
  // RPi가 최신 설정 버전을 적용(ACK)했는지 — lastAppliedVersion === version 이면 동기화 완료.
  const synced = computed(() => {
    const c = config.value
    return !!c && c.lastAppliedVersion === c.version
  })

  async function load(gid: string) {
    gatewayId.value = gid
    loading.value = true
    error.value = null
    try {
      full.value = await emergencyFailoverApi.getFull(gid)
    } catch (err: any) {
      error.value = err?.response?.data?.message ?? err?.message ?? '로드 실패'
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(dto: UpdateConfigDto) {
    if (!gatewayId.value) return
    saving.value = true
    error.value = null
    try {
      const updated = await emergencyFailoverApi.updateConfig(gatewayId.value, dto)
      if (full.value) full.value.config = { ...full.value.config, ...updated }
    } catch (err: any) {
      error.value = err?.response?.data?.message ?? err?.message ?? '저장 실패'
      throw err
    } finally {
      saving.value = false
    }
  }

  // 저장 후 RPi ACK로 lastAppliedVersion 이 version 을 따라잡을 때까지 폴링 (동기화 완료 확인용).
  async function refetchApplied() {
    if (!gatewayId.value) return
    try {
      const fresh = await emergencyFailoverApi.getFull(gatewayId.value)
      if (full.value && fresh?.config) {
        full.value.config.version = fresh.config.version
        full.value.config.lastAppliedVersion = fresh.config.lastAppliedVersion
        full.value.config.lastAppliedAt = fresh.config.lastAppliedAt
        if (fresh.status) full.value.status = fresh.status
      }
    } catch { /* transient — 폴링 지속 */ }
  }

  async function waitForSync(timeoutMs = 20000, intervalMs = 1500): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (synced.value) return true
      await new Promise((r) => setTimeout(r, intervalMs))
      await refetchApplied()
    }
    return synced.value
  }

  async function saveSchedule(month: number, dto: UpsertScheduleDto) {
    if (!gatewayId.value) return
    saving.value = true
    error.value = null
    try {
      const updated = await emergencyFailoverApi.upsertSchedule(
        gatewayId.value, month, dto,
      )
      if (full.value) {
        const idx = full.value.schedule.findIndex((s) => s.month === month)
        if (idx >= 0) full.value.schedule[idx] = updated
        else full.value.schedule.push(updated)
        full.value.schedule.sort((a, b) => a.month - b.month)
      }
    } catch (err: any) {
      error.value = err?.response?.data?.message ?? err?.message ?? '스케줄 저장 실패'
      throw err
    } finally {
      saving.value = false
    }
  }

  async function disableMonth(month: number) {
    if (!gatewayId.value) return
    saving.value = true
    try {
      await emergencyFailoverApi.disableSchedule(gatewayId.value, month)
      const row = full.value?.schedule.find((s) => s.month === month)
      if (row) row.enabled = false
    } finally {
      saving.value = false
    }
  }

  async function loadEvents(limit = 100) {
    if (!gatewayId.value) return
    const res = await emergencyFailoverApi.getEvents(gatewayId.value, limit, 0)
    events.value = res.data
  }

  async function resync() {
    if (!gatewayId.value) return
    await emergencyFailoverApi.resync(gatewayId.value)
  }

  async function emergencyStop(reason: string, by: string) {
    if (!gatewayId.value) return
    await emergencyFailoverApi.emergencyStop(gatewayId.value, reason, by)
  }

  // 실시간 WebSocket 구독
  let cleanupMode: (() => void) | null = null
  let cleanupEvent: (() => void) | null = null

  onMounted(() => {
    cleanupMode = onFallbackModeChanged((data) => {
      if (data.gatewayId !== gatewayId.value) return
      if (!full.value) return
      if (!full.value.status) {
        full.value.status = {
          gatewayId: data.gatewayId,
          mode: data.mode,
          modeChangedAt: data.modeChangedAt,
          lastHeartbeatSeenAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      } else {
        full.value.status.mode = data.mode
        full.value.status.modeChangedAt = data.modeChangedAt
        full.value.status.lastHeartbeatSeenAt = new Date().toISOString()
      }
    })
    cleanupEvent = onFallbackEvent((data) => {
      if (data.gatewayId !== gatewayId.value) return
      // 최신 이벤트를 목록 상단에 prepend (백엔드 ID 미정이므로 임시 ID 생성)
      events.value = [
        {
          id: `tmp-${Date.now()}`,
          gatewayId: data.gatewayId,
          eventType: data.eventType as FallbackEvent['eventType'],
          payload: data.payload,
          occurredAt: data.occurredAt,
          reportedAt: new Date().toISOString(),
        },
        ...events.value,
      ].slice(0, 50) // 최대 50개 유지
    })
  })

  onUnmounted(() => {
    cleanupMode?.()
    cleanupEvent?.()
  })

  return {
    gatewayId,
    full,
    config,
    schedule,
    status,
    mode,
    synced,
    events,
    loading,
    saving,
    error,
    load,
    saveConfig,
    waitForSync,
    saveSchedule,
    disableMonth,
    loadEvents,
    resync,
    emergencyStop,
  }
}
