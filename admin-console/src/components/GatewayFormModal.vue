<template>
  <div v-if="show" class="c-modal-back" @click.self="$emit('close')">
    <div class="c-modal" role="dialog" aria-modal="true" :aria-label="title">
      <div class="c-modal-h">{{ title }}<button class="c-link-btn" type="button" aria-label="닫기" @click="$emit('close')"><CIcon name="x" :size="16" /></button></div>
      <div class="c-modal-b">
        <div class="c-form-row">
          <label for="gwf-id">게이트웨이 ID (고유값)</label>
          <input id="gwf-id" v-model="form.gatewayId" class="c-input" :disabled="!!gateway" placeholder="예: lgw-farm01" />
        </div>
        <div class="c-form-row">
          <label for="gwf-name">이름</label>
          <input id="gwf-name" v-model="form.name" class="c-input" placeholder="예: 횡성 1호 농장" />
        </div>
        <div class="c-form-row">
          <label for="gwf-loc">위치</label>
          <input id="gwf-loc" v-model="form.location" class="c-input" placeholder="예: 강원도 횡성군" />
        </div>
        <div v-if="gateway" class="c-form-row">
          <label for="gwf-ip">라즈베리파이 IP (자동 보고)</label>
          <input id="gwf-ip" v-model="form.rpiIp" class="c-input" readonly placeholder="(Pi 부팅 후 자동 채워짐)" style="background:var(--c-surface-2);color:var(--c-text-muted)" />
        </div>
        <p v-else class="c-note">라즈베리파이의 IP·machineId·hostname 등은 Pi 첫 부팅 시 자동으로 보고됩니다. 여기서는 게이트웨이 ID만 미리 만들어 두면 Pi가 자동 등록됩니다.</p>
        <div class="c-form-row">
          <label for="gwf-owner">소유 농장</label>
          <select id="gwf-owner" v-model="form.userId" class="c-input">
            <option v-for="u in owners" :key="u.id" :value="u.id">{{ u.name }} ({{ u.username }})</option>
          </select>
        </div>
        <div v-if="gateway" class="c-form-row">
          <label for="gwf-house">연결 구역</label>
          <select id="gwf-house" v-model="form.groupId" class="c-input">
            <option value="">미지정</option>
            <option v-for="g in ownerGroups" :key="g.id" :value="g.id">{{ g.name }}{{ occupiedBy(g.id) ? ` — ${occupiedBy(g.id)} 연결됨` : '' }}</option>
          </select>
          <span class="c-muted" style="font-size:12px">한 구역에는 게이트웨이 1대만 연결할 수 있습니다.</span>
        </div>
      </div>
      <div class="c-modal-f">
        <button class="c-btn" type="button" @click="$emit('close')">취소</button>
        <button class="c-btn c-btn-pri" type="button" :disabled="saving" @click="save">{{ saving ? '저장 중…' : '저장' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 게이트웨이 등록/편집 — 기존 GatewayManagement.vue · UserManagement.vue 의 모달과 같은 필드·같은 API 호출.
 * 사용자 화면(B8)과 게이트웨이 화면(D3)이 공용으로 쓴다.
 */
import { computed, ref, watch } from 'vue'
import { gatewayApi } from '@/api/gateway.api'
import { useNotificationStore } from '@/stores/notification.store'
import CIcon from '@console/components/CIcon.vue'
import { usePlatformStore, type ConsoleGateway } from '@console/stores/platform.store'

const props = defineProps<{ show: boolean; gateway: ConsoleGateway | null; defaultUserId?: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const platform = usePlatformStore()
const notif = useNotificationStore()
const saving = ref(false)
const form = ref({ gatewayId: '', name: '', location: '', rpiIp: '', userId: '', groupId: '' })
/** 연결 구역 선택지 — 소유 농장의 구역 */
const ownerGroups = computed(() => platform.groupsOfFarm(form.value.userId))
/** 그 구역에 이미 연결된 다른 게이트웨이 이름 */
const occupiedBy = (groupId: string) => platform.gateways.find((g) => g.groupId === groupId && g.id !== props.gateway?.id)?.name ?? ''

const title = computed(() => (props.gateway ? '게이트웨이 편집' : '게이트웨이 등록'))
const owners = computed(() => platform.users.filter((u) => u.role !== 'farm_user'))

watch(() => props.show, (open) => {
  if (!open) return
  const gw = props.gateway
  form.value = gw
    ? { gatewayId: gw.gatewayId, name: gw.name, location: gw.location || '', rpiIp: gw.rpiIp || '', userId: gw.userId, groupId: gw.groupId || '' }
    : { gatewayId: '', name: '', location: '', rpiIp: '', userId: props.defaultUserId || '', groupId: '' }
}, { immediate: true })

async function save() {
  if (!form.value.gatewayId || !form.value.name) {
    notif.warning('입력 오류', '게이트웨이 ID와 이름은 필수입니다.')
    return
  }
  saving.value = true
  try {
    if (props.gateway) {
      await gatewayApi.update(props.gateway.id, { name: form.value.name, location: form.value.location, rpiIp: form.value.rpiIp, userId: form.value.userId, groupId: form.value.groupId || null })
      notif.success('수정 완료', '게이트웨이 정보가 수정되었습니다.')
    } else {
      await gatewayApi.create({ gatewayId: form.value.gatewayId, name: form.value.name, location: form.value.location, rpiIp: form.value.rpiIp, userId: form.value.userId })
      notif.success('등록 완료', '게이트웨이가 등록되었습니다.')
    }
    emit('saved')
  } catch (e: any) {
    notif.error('오류', e?.response?.data?.message || '저장 중 오류가 발생했습니다.')
  } finally {
    saving.value = false
  }
}
</script>
