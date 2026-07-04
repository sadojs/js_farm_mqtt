<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { gatewayApi } from '../api/gateway.api'
import { useEmergencyFailover } from '../composables/useEmergencyFailover'
import OpenerMonthDialog from '../components/emergency-failover/OpenerMonthDialog.vue'
import FailoverStatusCard from '../components/emergency-failover/FailoverStatusCard.vue'
import HeartbeatSettingsCard from '../components/emergency-failover/HeartbeatSettingsCard.vue'
import OpenerMonthlyScheduleCard from '../components/emergency-failover/OpenerMonthlyScheduleCard.vue'
import IrrigationFailoverCard from '../components/emergency-failover/IrrigationFailoverCard.vue'
import FertilizerFailoverCard from '../components/emergency-failover/FertilizerFailoverCard.vue'
import FanFailoverCard from '../components/emergency-failover/FanFailoverCard.vue'
import type { Gateway } from '../types/device.types'
import type { OpenerSchedule, UpsertScheduleDto, FanTriggerType } from '../types/emergency-failover.types'
import { eventTypeLabel, eventPayloadSummary, eventBadgeClass } from '../utils/fallback-event-humanizer'

const gateways = ref<Gateway[]>([])
const selectedGatewayId = ref<string | null>(null)

const fail = useEmergencyFailover()

const dialogOpen = ref(false)
const dialogMonth = ref(1)
const dialogInitial = ref<OpenerSchedule | null>(null)

const editable = ref({
  heartbeatTimeoutSeconds: 300,
  recoveryGraceSeconds: 30,
  openerEnabled: true,
  openerRainOverride: true,
  irrigationEnabled: true,
  irrigationMaxRuntimeMinutes: 30,
  fertilizerEnabled: true,
  fanEnabled: false,
  fanTriggerType: 'temperature' as FanTriggerType,
  fanOnTemp: 35,
  fanOffTemp: 28,
})

const fanValid = computed(() => {
  if (editable.value.fanOnTemp <= editable.value.fanOffTemp) return false
  if (editable.value.fanTriggerType === 'humidity') {
    const { fanOnTemp, fanOffTemp } = editable.value
    if (fanOnTemp < 0 || fanOnTemp > 100 || fanOffTemp < 0 || fanOffTemp > 100) return false
  }
  return true
})

// M-3: 최소 안전 룰 비활성화 시 경고
const allCriticalDisabled = computed(() =>
  !editable.value.openerEnabled
  && !editable.value.irrigationEnabled
  && !editable.value.fertilizerEnabled
  // 환기팬은 default 비활성이라 critical 판정에서 제외
)

onMounted(async () => {
  const { data } = await gatewayApi.getAll()
  gateways.value = data
  if (gateways.value.length > 0) {
    selectedGatewayId.value = gateways.value[0].gatewayId
  }
})

watch(selectedGatewayId, async (gid) => {
  if (!gid) return
  await fail.load(gid)
  // 로드 실패 시 후속 events 호출은 의미 없음
  if (fail.error.value) return
  await fail.loadEvents(20)
  if (fail.config.value) {
    editable.value = {
      heartbeatTimeoutSeconds: fail.config.value.heartbeatTimeoutSeconds,
      recoveryGraceSeconds: fail.config.value.recoveryGraceSeconds,
      openerEnabled: fail.config.value.openerEnabled,
      openerRainOverride: fail.config.value.openerRainOverride,
      irrigationEnabled: fail.config.value.irrigationEnabled,
      irrigationMaxRuntimeMinutes: fail.config.value.irrigationMaxRuntimeMinutes,
      fertilizerEnabled: fail.config.value.fertilizerEnabled,
      fanEnabled: fail.config.value.fanEnabled,
      fanTriggerType: (fail.config.value.fanTriggerType ?? 'temperature') as FanTriggerType,
      fanOnTemp: Number(fail.config.value.fanOnTemp),
      fanOffTemp: Number(fail.config.value.fanOffTemp),
    }
  }
})

function openMonth(month: number) {
  dialogMonth.value = month
  dialogInitial.value = fail.schedule.value.find((s) => s.month === month) ?? null
  dialogOpen.value = true
}

async function onSaveSchedule(dto: UpsertScheduleDto) {
  await fail.saveSchedule(dialogMonth.value, dto)
  dialogOpen.value = false
}

async function saveAll() {
  if (!fanValid.value) {
    alert('환기팬 ON 임계값은 OFF 임계값보다 커야 합니다')
    return
  }
  if (allCriticalDisabled.value) {
    if (!confirm('개폐기·관수·액비 폴백이 모두 비활성화되어 있습니다. 통신 단절 시 안전망이 없어 작물 피해가 발생할 수 있습니다. 그래도 저장할까요?')) {
      return
    }
  }
  await fail.saveConfig(editable.value)
  const ok = await fail.waitForSync()
  if (ok) {
    alert(`저장 및 게이트웨이 동기화 완료 (v${fail.config.value?.version}).`)
  } else {
    alert('저장되었습니다. 다만 게이트웨이 동기화 확인이 지연됩니다(응답 없음) — 게이트웨이 온라인 상태와 상태 카드의 동기화 배지를 확인하세요.')
  }
}

async function resync() {
  await fail.resync()
  alert('재동기화 메시지를 발행했습니다.')
}

async function emergencyStop() {
  if (!confirm('정말 모든 릴레이를 비상 정지하시겠습니까? 폴백 모드에서도 즉시 실행됩니다.')) return
  await fail.emergencyStop('manual-from-ui', 'admin')
  alert('비상 정지 명령을 발행했습니다.')
}

function fmt(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleString('ko-KR', { hour12: false })
}
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <div>
        <h2>이머전시 페일오버</h2>
        <p class="page-description">서버와 통신 단절 시 라즈베리파이가 로컬 룰로 작물 안전 동작을 수행합니다.</p>
      </div>
      <div class="gw-select">
        <label>게이트웨이</label>
        <select v-model="selectedGatewayId">
          <option v-for="g in gateways" :key="g.gatewayId" :value="g.gatewayId">
            {{ g.name }} ({{ g.gatewayId }})
          </option>
        </select>
      </div>
    </header>

    <div v-if="!selectedGatewayId" class="loading">게이트웨이를 먼저 선택하세요.</div>
    <div v-else-if="fail.loading.value" class="loading">로딩 중...</div>
    <div v-else-if="fail.error.value" class="error">
      <strong>⚠ 폴백 설정을 불러올 수 없습니다.</strong>
      <p>{{ fail.error.value }}</p>
      <p class="error-hint">
        백엔드 마이그레이션 020이 적용되었는지, 게이트웨이가 올바르게 등록되었는지 확인하세요.
        새로고침 시 자동 복구를 시도합니다.
      </p>
    </div>
    <div v-else-if="!fail.config.value" class="error">
      <strong>⚠ 폴백 설정 데이터가 없습니다.</strong>
      <p>이 게이트웨이는 마이그레이션 020 이전에 등록된 것으로 보입니다.
        페이지를 새로고침하면 백엔드가 자동으로 시드 생성합니다.</p>
    </div>
    <template v-else>

      <FailoverStatusCard
        :mode="fail.mode.value"
        :status="fail.status.value"
        :config="fail.config.value"
        @resync="resync"
        @emergency-stop="emergencyStop"
      />

      <!-- M-3: 최소 안전 룰 비활성화 경고 -->
      <div v-if="allCriticalDisabled" class="warning-banner">
        ⚠️ <strong>경고:</strong> 개폐기·관수·액비 폴백이 모두 비활성화되어 있습니다.
        통신 단절 시 안전망이 없어 작물 피해가 발생할 수 있습니다.
        최소 한 가지 이상의 폴백을 활성화하는 것을 강력히 권장합니다.
      </div>

      <HeartbeatSettingsCard
        v-model:heartbeatTimeoutSeconds="editable.heartbeatTimeoutSeconds"
        v-model:recoveryGraceSeconds="editable.recoveryGraceSeconds"
      />

      <OpenerMonthlyScheduleCard
        v-model:openerEnabled="editable.openerEnabled"
        v-model:openerRainOverride="editable.openerRainOverride"
        :schedule="fail.schedule.value"
        @edit-month="openMonth"
      />

      <IrrigationFailoverCard
        v-model:irrigationEnabled="editable.irrigationEnabled"
        v-model:irrigationMaxRuntimeMinutes="editable.irrigationMaxRuntimeMinutes"
      />

      <FertilizerFailoverCard
        v-model:fertilizerEnabled="editable.fertilizerEnabled"
      />

      <FanFailoverCard
        v-model:fanEnabled="editable.fanEnabled"
        v-model:fanTriggerType="editable.fanTriggerType"
        v-model:fanOnTemp="editable.fanOnTemp"
        v-model:fanOffTemp="editable.fanOffTemp"
      />

      <!-- 폴백 측정값 소스 안내 -->
      <section class="card info-card">
        <h3>ℹ️ 폴백 모드 측정값 소스</h3>
        <p>
          폴백 모드(서버 단절) 동안 라즈베리파이는 이 게이트웨이에 연결된
          <strong>모든 온/습도 측정기</strong> 의 가장 최근 수신 값을 사용합니다.
          (<code>구역 관리 → 센서 환경 설정</code> 의 내부 온/습도 매핑과는 <strong>별개</strong> —
          오프라인 상태에서 매핑 정보 조회가 불가능하기 때문)
        </p>
        <ul>
          <li>특정 측정기의 값으로 동작시키려면 해당 게이트웨이에 그 측정기만 연결하세요.</li>
          <li>여러 측정기가 있으면 마지막에 게시된 값이 사용됩니다 (각 측정기가 평균으로 합산되지 않음).</li>
          <li>온라인 복귀 시 자동제어 룰이 다시 메인 컨트롤러를 잡으며, 폴백 사용 임계값은 안전망입니다.</li>
        </ul>
      </section>

      <!-- 최근 이벤트 (한글화) -->
      <section class="card" v-if="fail.events.value.length">
        <h3>최근 폴백 이벤트 ({{ fail.events.value.length }}건)</h3>
        <table class="events-table">
          <thead>
            <tr>
              <th>시각</th>
              <th>유형</th>
              <th>상세</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in fail.events.value" :key="e.id">
              <td>{{ fmt(e.occurredAt) }}</td>
              <td>
                <span :class="['badge-event', `badge-${eventBadgeClass(e.eventType)}`]">
                  {{ eventTypeLabel(e.eventType) }}
                </span>
              </td>
              <td>{{ eventPayloadSummary(e) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="page-footer">
        <button class="btn-primary" :disabled="fail.saving.value || !fanValid" @click="saveAll">
          {{ fail.saving.value ? '저장 중...' : '저장 (게이트웨이에 동기화)' }}
        </button>
      </footer>
    </template>

    <OpenerMonthDialog
      :open="dialogOpen"
      :month="dialogMonth"
      :initial="dialogInitial"
      @close="dialogOpen = false"
      @save="onSaveSchedule"
    />
  </div>
</template>

<style scoped>
.page-container { padding: 24px; max-width: 1100px; margin: 0 auto; }
.page-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 24px; gap: 16px; flex-wrap: wrap;
}
.page-header h2 { margin: 0 0 4px 0; }
.page-description { color: var(--text-secondary, #666); margin: 0; }
.gw-select { display: flex; flex-direction: column; gap: 4px; }
.gw-select select {
  padding: 8px; border-radius: 6px;
  border: 1px solid var(--border-color, #ccc); min-width: 240px;
}

.loading, .error { padding: 32px; text-align: center; color: var(--text-secondary, #666); }
.error {
  color: var(--danger, #d32f2f); background: #fff3e0;
  border: 1px solid #ffb74d; border-radius: 8px;
  text-align: left; padding: 20px;
}
.error strong { display: block; margin-bottom: 8px; font-size: 16px; }
.error-hint { margin-top: 8px; font-size: 13px; color: #e65100; }

.warning-banner {
  background: #fff3e0; border: 1px solid #ffb74d;
  color: #e65100; padding: 12px 16px; border-radius: 8px;
  margin-bottom: 16px; font-size: 14px; line-height: 1.5;
}

.card {
  background: var(--card-bg, #fff); border-radius: 12px;
  padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
}
.card h3 { margin: 0 0 12px 0; font-size: 16px; }

.events-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.events-table th, .events-table td {
  padding: 4px 0; text-align: left; border-bottom: 1px solid var(--border-color, #eee);
}
.events-table code { font-size: 11px; }
.badge-event {
  padding: 2px 8px; border-radius: 8px; font-size: 11px;
  background: var(--info-bg, #f0f4f8); color: var(--text-secondary, #555);
}
.badge-event.badge-danger { background: #ffebee; color: #c62828; }
.badge-event.badge-warning { background: #fff3e0; color: #ef6c00; }
.badge-event.badge-info { background: #e3f2fd; color: #1565c0; }
.badge-event.badge-success { background: #e8f5e9; color: #2e7d32; }
.badge-event.badge-neutral { background: var(--info-bg, #f0f4f8); color: var(--text-secondary, #555); }

.info-card { background: #f0f4f8; border-color: #b0bec5; }
.info-card p { margin: 0 0 8px 0; line-height: 1.6; font-size: 14px; color: #37474f; }
.info-card ul { margin: 8px 0 0 20px; padding: 0; font-size: 13px; color: #455a64; line-height: 1.7; }
.info-card code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 4px; font-size: 12px; }

.page-footer { display: flex; justify-content: flex-end; margin-top: 24px; }
.btn-primary {
  padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px;
  border: 1px solid transparent;
  background: var(--primary, #4caf50); color: #fff;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 768px) {
  /* 다른 페이지와 동일한 좌우 여백 */
  .page-container { padding: 4px 0; }
  .page-header { margin-bottom: 14px; }
}
</style>
