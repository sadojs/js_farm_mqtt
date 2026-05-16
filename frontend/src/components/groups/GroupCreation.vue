<template>
  <div v-if="show" class="modal-overlay" @click.self="closeModal">
    <div class="modal-container">
      <div class="modal-header">
        <h2>하우스 구역 만들기</h2>
        <button class="close-btn" @click="closeModal">✕</button>
      </div>

      <div class="modal-body">
        <!-- 구역 정보 입력 -->
        <div class="form-section">
          <h3>구역 정보</h3>
          <div class="form-group">
            <label>구역 이름 *</label>
            <input
              v-model="groupData.name"
              type="text"
              placeholder="예: 1동 하우스"
              class="form-input"
            />
          </div>
          <div class="form-group">
            <label>설명</label>
            <textarea
              v-model="groupData.description"
              placeholder="구역에 대한 설명을 입력하세요"
              class="form-textarea"
              rows="2"
            />
          </div>
          <div class="form-group">
            <label>관리자</label>
            <input
              v-model="groupData.manager"
              type="text"
              placeholder="담당자 이름"
              class="form-input"
            />
          </div>
        </div>

        <!-- 라즈베리파이 할당 -->
        <div class="form-section">
          <h3>라즈베리파이 할당</h3>
          <p class="section-desc">이 구역에서 사용할 라즈베리파이(게이트웨이)를 선택하세요. 게이트웨이의 환경 설정에서 활성화된 장치가 이 구역에 자동으로 표시됩니다.</p>

          <div v-if="loadingGateways" class="empty-devices"><p>게이트웨이 목록 불러오는 중...</p></div>
          <div v-else-if="availableGateways.length === 0" class="empty-devices">
            <p>할당 가능한 게이트웨이가 없습니다. 먼저 게이트웨이를 등록하세요.</p>
          </div>

          <div v-else class="gateways-list">
            <div
              v-for="gw in availableGateways"
              :key="gw.id"
              class="gateway-item"
              :class="{ selected: selectedGatewayIds.includes(gw.id) }"
              @click="toggleGateway(gw.id)"
            >
              <input
                type="checkbox"
                :checked="selectedGatewayIds.includes(gw.id)"
                @click.stop
                @change="toggleGateway(gw.id)"
              />
              <div class="gw-icon">🍓</div>
              <div class="gw-info">
                <div class="gw-name">{{ gw.name }}</div>
                <div class="gw-meta">{{ gw.gatewayId }}<span v-if="gw.location"> · {{ gw.location }}</span></div>
              </div>
              <span :class="['status-dot', gw.agentStatus === 'online' || gw.status === 'online' ? 'online' : 'offline']"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="closeModal">취소</button>
        <button
          class="btn-primary"
          :disabled="!isValid || creating"
          @click="handleCreate"
        >
          <span v-if="creating">생성 중...</span>
          <span v-else>구역 만들기</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGroupStore } from '../../stores/group.store'
import { gatewayApi } from '@/api/gateway.api'
import { gatewayEnvApi } from '@/api/gateway-env.api'
import type { Gateway } from '@/types/device.types'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  close: []
  created: []
}>()

const groupStore = useGroupStore()

const creating = ref(false)
const loadingGateways = ref(false)
const availableGateways = ref<Gateway[]>([])
const selectedGatewayIds = ref<string[]>([])

function toggleGateway(id: string) {
  const idx = selectedGatewayIds.value.indexOf(id)
  if (idx === -1) selectedGatewayIds.value.push(id)
  else selectedGatewayIds.value.splice(idx, 1)
}

const groupData = ref({ name: '', description: '', manager: '' })

watch(() => props.show, async (open) => {
  if (open) {
    loadingGateways.value = true
    try {
      const res = await gatewayApi.getAll()
      availableGateways.value = res.data as unknown as Gateway[]
    } catch {
      availableGateways.value = []
    } finally {
      loadingGateways.value = false
    }
  }
})

const isValid = computed(() => groupData.value.name.trim() !== '')

const handleCreate = async () => {
  if (!isValid.value) return
  creating.value = true
  try {
    const group = await groupStore.createGroup({
      name: groupData.value.name,
      description: groupData.value.description,
      manager: groupData.value.manager,
    })
    if (selectedGatewayIds.value.length > 0 && group?.id) {
      const failedGateways: string[] = []
      for (const gwId of selectedGatewayIds.value) {
        try {
          await gatewayApi.assignZone(gwId, group.id)
          // trigger onboard device sync so zone management shows activated devices
          gatewayEnvApi.getOnboard(gwId).catch(() => {})
        } catch (gwErr: any) {
          const msg = gwErr?.response?.data?.message || '할당 실패'
          const gw = availableGateways.value.find(g => g.id === gwId)
          failedGateways.push(`${gw?.name || gwId}: ${msg}`)
        }
      }
      if (failedGateways.length > 0) {
        alert(`구역은 생성되었으나 일부 게이트웨이 할당에 실패했습니다:\n\n${failedGateways.join('\n')}`)
      }
    }
    emit('created')
    closeModal()
  } catch (err: any) {
    console.error('구역 생성 실패:', err)
    const status = err?.response?.status
    const serverMsg = err?.response?.data?.message
    if (status === 409) {
      alert(`게이트웨이 할당 실패\n\n${serverMsg || '이 게이트웨이는 이미 다른 구역에 할당되어 있습니다.'}`)
    } else if (status === 403) {
      alert('접근 권한이 없습니다.')
    } else {
      alert('구역 생성에 실패했습니다.')
    }
  } finally {
    creating.value = false
  }
}

const closeModal = () => {
  emit('close')
  setTimeout(() => {
    groupData.value = { name: '', description: '', manager: '' }
    selectedGatewayIds.value = []
  }, 300)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-container {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
  border: 1px solid var(--border-color);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid var(--border-input);
}

.modal-header h2 { font-size: 22px; font-weight: 700; margin: 0; }

.close-btn {
  background: none; border: none; font-size: 20px;
  color: var(--text-muted); cursor: pointer; padding: 4px;
  border-radius: 4px;
}
.close-btn:hover { background: var(--bg-hover); }

.modal-body { flex: 1; overflow-y: auto; padding: 24px; }

.form-section { margin-bottom: 28px; }
.form-section:last-child { margin-bottom: 0; }
.form-section h3 { font-size: 17px; font-weight: 600; margin-bottom: 10px; }

.section-desc { font-size: 13px; color: var(--text-secondary); margin: -4px 0 14px; }

.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.form-input, .form-textarea {
  width: 100%; padding: 10px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: 8px; font-size: 14px;
  background: var(--bg-input); color: var(--text-primary);
  font-family: inherit;
}
.form-input:focus, .form-textarea:focus {
  outline: none; border-color: #4caf50;
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
}
.form-textarea { resize: vertical; min-height: 56px; }

.empty-devices {
  padding: 24px; text-align: center;
  background: var(--bg-secondary); border-radius: 8px;
}
.empty-devices p { color: var(--text-secondary); font-size: 14px; margin: 0; }

.gateways-list { display: flex; flex-direction: column; gap: 8px; }

.gateway-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1.5px solid var(--border-input);
  border-radius: 10px; cursor: pointer;
  transition: all 0.15s;
}
.gateway-item:hover { background: var(--bg-hover); }
.gateway-item.selected {
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.06);
}

.gw-icon { font-size: 22px; }
.gw-info { flex: 1; }
.gw-name { font-size: 15px; font-weight: 600; }
.gw-meta { font-size: 12px; color: var(--text-secondary); font-family: monospace; margin-top: 2px; }

.status-dot {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
}
.status-dot.online { background: #4caf50; }
.status-dot.offline { background: #d1d5db; }

.modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 20px 24px; border-top: 1px solid var(--border-input);
}
.btn-primary, .btn-secondary {
  padding: 10px 22px; border: none; border-radius: 10px;
  font-weight: 600; font-size: 15px; cursor: pointer;
}
.btn-primary { background: #4caf50; color: white; }
.btn-primary:hover:not(:disabled) { background: #45a049; }
.btn-primary:disabled { background: var(--text-muted); cursor: not-allowed; opacity: 0.6; }
.btn-secondary { background: var(--bg-secondary); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-hover); }
</style>
