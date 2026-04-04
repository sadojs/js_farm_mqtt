<template>
  <div v-if="show && targetGroup" class="modal-overlay" @click.self="$emit('close')">
    <div class="remove-device-modal">
      <div class="add-modal-header">
        <h3>장치 제거 — {{ targetGroup.name }}</h3>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="remove-modal-desc">
        제거할 장치를 선택하세요. 장치 자체는 삭제되지 않으며 구역에서만 해제됩니다.
      </div>
      <div class="add-modal-body">
        <!-- 센서 -->
        <template v-if="sensors.length > 0">
          <div class="remove-section-label sensor">측정기</div>
          <div
            v-for="device in sensors"
            :key="device.id"
            class="device-row clickable"
            :class="{ selected: checked.has(device.id) }"
            @click="toggleItem(device.id)"
          >
            <input type="checkbox" :checked="checked.has(device.id)" @click.stop />
            <span :class="['status-dot', device.online ? 'online' : 'offline']" style="flex-shrink:0"></span>
            <span class="device-row-name">{{ device.name }}</span>
            <span v-if="loadingDeps.has(device.id)" class="dep-loading">확인 중...</span>
            <span v-else-if="(warnings[device.id]?.length ?? 0) > 0" class="dep-warning">
              ⚠ 자동 제어 설정: {{ warnings[device.id].map(r => r.name).join(', ') }}
            </span>
            <span :class="['status-indicator', device.online ? 'online' : 'offline']">
              {{ device.online ? '온라인' : '오프라인' }}
            </span>
          </div>
        </template>

        <!-- 개폐기 -->
        <template v-if="openers.length > 0">
          <div class="remove-section-label actuator">개폐기</div>
          <div
            v-for="og in openers"
            :key="og.openDevice.id"
            class="device-row clickable"
            :class="{ selected: checked.has(og.openDevice.id) }"
            @click="toggleItem(og.openDevice.id)"
          >
            <input type="checkbox" :checked="checked.has(og.openDevice.id)" @click.stop />
            <span :class="['status-dot', og.openDevice.online || og.closeDevice.online ? 'online' : 'offline']" style="flex-shrink:0"></span>
            <span class="device-row-name">{{ og.groupName }} <span class="pair-hint">(열림/닫힘 쌍)</span></span>
            <span v-if="loadingDeps.has(og.openDevice.id)" class="dep-loading">확인 중...</span>
            <span v-else-if="(warnings[og.openDevice.id]?.length ?? 0) > 0" class="dep-warning">
              ⚠ 자동 제어 설정: {{ warnings[og.openDevice.id].map(r => r.name).join(', ') }}
            </span>
          </div>
        </template>

        <!-- 관수 -->
        <template v-if="irrigations.length > 0">
          <div class="remove-section-label actuator">관주</div>
          <div
            v-for="device in irrigations"
            :key="device.id"
            class="device-row clickable"
            :class="{ selected: checked.has(device.id) }"
            @click="toggleItem(device.id)"
          >
            <input type="checkbox" :checked="checked.has(device.id)" @click.stop />
            <span :class="['status-dot', device.online ? 'online' : 'offline']" style="flex-shrink:0"></span>
            <span class="device-row-name">{{ device.name }}</span>
            <span v-if="loadingDeps.has(device.id)" class="dep-loading">확인 중...</span>
            <span v-else-if="(warnings[device.id]?.length ?? 0) > 0" class="dep-warning">
              ⚠ 자동 제어 설정: {{ warnings[device.id].map(r => r.name).join(', ') }}
            </span>
            <span :class="['status-indicator', device.online ? 'online' : 'offline']">
              {{ device.online ? '온라인' : '오프라인' }}
            </span>
          </div>
        </template>

        <!-- 일반 장치 -->
        <template v-if="actuators.length > 0">
          <div class="remove-section-label actuator">장치</div>
          <div
            v-for="device in actuators"
            :key="device.id"
            class="device-row clickable"
            :class="{ selected: checked.has(device.id) }"
            @click="toggleItem(device.id)"
          >
            <input type="checkbox" :checked="checked.has(device.id)" @click.stop />
            <span :class="['status-dot', device.online ? 'online' : 'offline']" style="flex-shrink:0"></span>
            <span class="device-row-name">{{ device.name }}</span>
            <span v-if="loadingDeps.has(device.id)" class="dep-loading">확인 중...</span>
            <span v-else-if="(warnings[device.id]?.length ?? 0) > 0" class="dep-warning">
              ⚠ 자동 제어 설정: {{ warnings[device.id].map(r => r.name).join(', ') }}
            </span>
            <span :class="['status-indicator', device.online ? 'online' : 'offline']">
              {{ device.online ? '온라인' : '오프라인' }}
            </span>
          </div>
        </template>

        <div v-if="sensors.length === 0 && openers.length === 0 && irrigations.length === 0 && actuators.length === 0" class="empty-state-sm">
          <p>제거할 장치가 없습니다.</p>
        </div>
      </div>

      <div v-if="hasWarning" class="remove-warning-banner">
        ⚠ 선택한 장치 중 자동 제어 설정에서 사용 중인 항목이 있습니다. 자동 제어 설정을 먼저 수정해 주세요.
      </div>

      <div class="add-modal-footer">
        <button class="btn-secondary" @click="$emit('close')">취소</button>
        <button
          class="btn-danger"
          :disabled="checked.size === 0 || hasWarning || removing"
          @click="confirmRemove"
        >
          <span v-if="removing">제거 중...</span>
          <span v-else-if="checked.size === 0">장치를 선택하세요</span>
          <span v-else-if="hasWarning">자동 제어 설정 먼저 처리 필요</span>
          <span v-else>{{ checked.size }}개 제거</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGroupStore } from '../../stores/group.store'
import { groupApi } from '../../api/group.api'
import { deviceApi } from '../../api/device.api'
import type { HouseGroup } from '../../types/group.types'
import type { Device, DependencyRule } from '../../types/device.types'

interface OpenerGroupInfo {
  groupName: string
  openDevice: Device
  closeDevice: Device
}

const props = defineProps<{
  show: boolean
  targetGroup: HouseGroup | null
  sensors: Device[]
  openers: OpenerGroupInfo[]
  irrigations: Device[]
  actuators: Device[]
}>()

const emit = defineEmits<{
  close: []
  removed: []
}>()

const groupStore = useGroupStore()
const checked = ref<Set<string>>(new Set())
const warnings = ref<Record<string, DependencyRule[]>>({})
const loadingDeps = ref<Set<string>>(new Set())
const removing = ref(false)

const hasWarning = computed(() =>
  [...checked.value].some(id => (warnings.value[id]?.length ?? 0) > 0)
)

watch(() => props.show, (val) => {
  if (val) {
    checked.value = new Set()
    warnings.value = {}
    loadingDeps.value = new Set()
  }
})

const toggleItem = async (deviceId: string) => {
  const next = new Set(checked.value)
  if (next.has(deviceId)) {
    next.delete(deviceId)
  } else {
    next.add(deviceId)
    if (!(deviceId in warnings.value) && !loadingDeps.value.has(deviceId)) {
      loadingDeps.value = new Set([...loadingDeps.value, deviceId])
      try {
        const { data: deps } = await deviceApi.getDependencies(deviceId)
        warnings.value = { ...warnings.value, [deviceId]: deps.automationRules }
      } catch {
        warnings.value = { ...warnings.value, [deviceId]: [] }
      } finally {
        const s = new Set(loadingDeps.value)
        s.delete(deviceId)
        loadingDeps.value = s
      }
    }
  }
  checked.value = next
}

const confirmRemove = async () => {
  if (!props.targetGroup || checked.value.size === 0) return
  removing.value = true
  try {
    const openerOpenIds = new Set(props.openers.map(og => og.openDevice.id))
    for (const id of checked.value) {
      if (openerOpenIds.has(id)) {
        const og = props.openers.find(o => o.openDevice.id === id)
        if (og) {
          await groupApi.removeDeviceFromGroup(props.targetGroup.id, og.openDevice.id)
          await groupApi.removeDeviceFromGroup(props.targetGroup.id, og.closeDevice.id)
        }
      } else {
        await groupStore.removeDeviceFromGroup(props.targetGroup.id, id)
      }
    }
    await groupStore.fetchGroups()
    emit('removed')
    emit('close')
  } catch (err) {
    console.error('구역 장치 제거 실패:', err)
    alert('장치 제거에 실패했습니다.')
  } finally {
    removing.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
}
.remove-device-modal {
  background: var(--bg-card); border-radius: 16px;
  width: 100%; max-width: 560px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal);
}
.add-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.add-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; }
.remove-modal-desc {
  padding: 10px 24px 0;
  font-size: calc(13px * var(--content-scale, 1));
  color: var(--text-secondary); line-height: 1.5;
}
.add-modal-body {
  flex: 1; overflow-y: auto; padding: 16px 24px; max-height: 400px;
}
.add-modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 16px 24px; border-top: 1px solid var(--border-color);
}
.close-btn {
  background: none; border: none; font-size: 20px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
}
.btn-secondary {
  padding: 10px 20px; background: var(--bg-hover); color: var(--text-primary);
  border: none; border-radius: 8px; font-weight: 500; cursor: pointer;
}
.btn-danger {
  padding: 10px 20px; background: var(--danger); color: white;
  border: none; border-radius: 8px; font-weight: 600;
  font-size: calc(14px * var(--content-scale, 1)); cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #dc2626; }
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
.device-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; font-size: calc(14px * var(--content-scale, 1));
  border-bottom: 1px solid var(--border-light);
}
.device-row:last-child { border-bottom: none; }
.device-row.clickable { cursor: pointer; }
.device-row.clickable:hover { background: var(--bg-hover); }
.device-row.selected { background: var(--accent-bg); }
.device-row input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
.device-row-name { flex: 1; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot.online { background: var(--toggle-on); }
.status-dot.offline { background: var(--border-color); }
.status-indicator {
  font-size: calc(13px * var(--content-scale, 1)); font-weight: 500; flex-shrink: 0;
  padding: 2px 8px; border-radius: 8px;
}
.status-indicator.online { background: var(--accent-bg); color: var(--accent); }
.status-indicator.offline { background: var(--danger-bg); color: var(--danger); }
.remove-section-label {
  font-size: calc(12px * var(--content-scale, 1)); font-weight: 600;
  padding: 4px 12px; border-radius: 4px; display: inline-block; margin: 8px 0 4px;
}
.remove-section-label.sensor { background: var(--sensor-bg); color: var(--sensor-accent); }
.remove-section-label.actuator { background: var(--accent-bg); color: var(--accent); }
.dep-loading { font-size: calc(12px * var(--content-scale, 1)); color: var(--text-muted); flex-shrink: 0; }
.dep-warning {
  font-size: calc(11px * var(--content-scale, 1)); color: var(--danger);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.pair-hint { font-size: calc(11px * var(--content-scale, 1)); color: var(--text-muted); font-weight: 400; }
.remove-warning-banner {
  margin: 0 16px; padding: 10px 14px;
  background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px; font-size: calc(13px * var(--content-scale, 1));
  color: var(--danger); line-height: 1.4;
}
.empty-state-sm { padding: 32px; text-align: center; color: var(--text-muted); }

@media (max-width: 768px) {
  .modal-overlay { padding: 0; }
  .remove-device-modal {
    border-radius: 0; max-width: 100%; max-height: 100%;
    height: 100vh; height: 100dvh; overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
}
</style>
