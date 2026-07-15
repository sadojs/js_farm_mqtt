<template>
  <div class="modal-overlay" @click.self="onCloseAttempt">
    <div class="visibility-modal">
      <div class="modal-head">
        <h3>구역 표시 설정</h3>
        <button class="close-btn" @click="onCloseAttempt" aria-label="닫기">✕</button>
      </div>

      <p class="modal-desc">
        IoT 사용을 끄면 <strong>구역 관리 · 게이트웨이 환경 설정 · 자동 제어</strong> 대상에서 제외됩니다.
        <br />방재 일정·농작업 일정·생육관리에는 계속 표시됩니다.
      </p>

      <ul v-if="flatHouses.length" class="house-list">
        <li
          v-for="g in flatHouses"
          :key="g.id"
          class="house-row"
          :class="{ off: !draft[g.id], reorderable: canEdit, dragging: reorderDraggingId === g.id }"
          :style="reorderDragStyle(g.id)"
          :data-reorder-id="g.id"
          data-reorder-group="zones"
        >
          <span
            v-if="canEdit"
            class="drag-grip"
            title="길게 눌러 순서 이동"
            @pointerdown="reorderPress($event, g.id, 'zones', flatHouses.map(x => x.id))"
          ></span>
          <span class="row-icon">⛶</span>
          <div class="row-main">
            <div class="row-title">{{ g.name }}</div>
            <div class="row-sub">{{ formatMeta(g) }}</div>
          </div>
          <label class="toggle-wrap" :class="{ disabled: !canEdit }">
            <input
              type="checkbox"
              :checked="!!draft[g.id]"
              :disabled="!canEdit"
              role="switch"
              :aria-label="`${g.name} IoT 사용`"
              @change="onToggle(g.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="track"><span class="thumb"></span></span>
            <span class="toggle-label">{{ draft[g.id] ? 'IoT 사용' : '미사용' }}</span>
          </label>
        </li>
      </ul>
      <div v-if="canEdit && flatHouses.length > 1" class="reorder-hint">⇅ 왼쪽 손잡이를 길게 눌러 순서 변경 — 놓는 즉시 저장되고 메인 화면에 반영됩니다</div>
      <div v-if="!flatHouses.length" class="empty">등록된 구역이 없습니다.</div>

      <p v-if="!canEdit" class="readonly-hint">관리자에게 문의하세요. (farm_user 권한)</p>

      <div class="modal-foot">
        <button class="btn-ghost" @click="onCloseAttempt">닫기</button>
        <button
          class="btn-primary"
          :disabled="!canEdit || !hasChanges || saving"
          @click="onSave"
        >{{ saving ? '저장 중…' : '저장' }}</button>
      </div>
    </div>

    <!-- 영향 카운트 확인 -->
    <div v-if="confirmCounts" class="modal-overlay confirm-layer" @click.self="confirmCounts = null">
      <div class="confirm-modal">
        <h3>⚠️ IoT 화면에서 숨기시겠습니까?</h3>
        <p>아래 구역들에는 다음 자원이 연결되어 있습니다.</p>
        <ul class="confirm-list">
          <li v-for="h in confirmCounts.perHouse.filter(x => x.device + x.rule + x.gateway > 0)" :key="h.id">
            <strong>{{ h.name }}</strong>
            <span class="meta">장치 {{ h.device }} · 룰 {{ h.rule }} · 게이트웨이 {{ h.gateway }}</span>
          </li>
        </ul>
        <p class="note">IoT 화면에서만 숨겨지며, 실제 자동제어 / 알림 동작은 그대로 유지됩니다.</p>
        <div class="actions">
          <button class="btn-ghost" @click="confirmCounts = null">취소</button>
          <button class="btn-danger" @click="commitSave">숨기기</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useGroupStore } from '@/stores/group.store'
import { useNotificationStore } from '@/stores/notification.store'
import { groupApi } from '@/api/group.api'
import { useReorder } from '@/composables/useReorder'
import type { HouseGroupWithOwner, IotRelatedCounts } from '@/types/group.types'

const props = defineProps<{
  groups: HouseGroupWithOwner[]
  canEdit: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const groupStore = useGroupStore()
const notify = useNotificationStore()

// 토글 단위는 group (사용자가 화면에서 보는 "구역 카드"와 1:1). displayOrder 순 정렬.
const flatHouses = computed<HouseGroupWithOwner[]>(() =>
  [...(props.groups ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
)

// 구역 순서 드래그 — displayOrder 낙관적 갱신 + 서버 저장(메인 화면과 동일 순서)
const { press: reorderPress, draggingId: reorderDraggingId, dragStyle: reorderDragStyle } = useReorder({
  setOrder: (id, v) => { const g = (props.groups ?? []).find(x => x.id === id); if (g) g.displayOrder = v },
  getOrder: (id) => (props.groups ?? []).find(x => x.id === id)?.displayOrder ?? 0,
  persist: async (orders) => {
    await groupApi.reorder(orders)
    notify.success('구역 순서', '순서를 저장했어요. (아래 저장 버튼은 IoT 사용 여부용)')
  },
})

const draft = ref<Record<string, boolean>>({})
const original = ref<Record<string, boolean>>({})

const metaCounts = ref<Record<string, { device: number; rule: number; gateway: number }>>({})

onMounted(async () => {
  for (const g of flatHouses.value) {
    draft.value[g.id] = g.iotEnabled !== false
    original.value[g.id] = g.iotEnabled !== false
  }
  const ids = flatHouses.value.map(g => g.id)
  if (ids.length) {
    try {
      const { data } = await groupApi.getIotRelatedCounts(ids)
      for (const x of data.perHouse) {
        metaCounts.value[x.id] = { device: x.device, rule: x.rule, gateway: x.gateway }
      }
    } catch {
      /* 메타 조회 실패해도 모달 자체는 동작 */
    }
  }
})

const changedIds = computed(() =>
  Object.keys(draft.value).filter(id => draft.value[id] !== original.value[id]),
)
const hasChanges = computed(() => changedIds.value.length > 0)
const turningOff = computed(() =>
  changedIds.value.filter(id => !draft.value[id]),
)

const confirmCounts = ref<IotRelatedCounts | null>(null)
const saving = ref(false)

function onToggle(id: string, value: boolean) {
  if (!props.canEdit) return
  draft.value = { ...draft.value, [id]: value }
}

function formatMeta(g: HouseGroupWithOwner): string {
  const c = metaCounts.value[g.id]
  const parts: string[] = []
  if (c) {
    if (c.device > 0) parts.push(`장치 ${c.device}`)
    if (c.gateway > 0) parts.push(`게이트웨이 ${c.gateway}`)
    if (c.rule > 0) parts.push(`자동화 룰 ${c.rule}`)
  }
  if (!parts.length) parts.push('등록된 IoT 장치 없음')
  if (g.description) parts.push(g.description)
  return parts.join(' · ')
}

async function onSave() {
  if (!props.canEdit || !hasChanges.value) return
  if (turningOff.value.length === 0) return commitSave()
  try {
    const { data } = await groupApi.getIotRelatedCounts(turningOff.value)
    const t = data.totals
    if (t.device + t.rule + t.gateway === 0) return commitSave()
    confirmCounts.value = data
  } catch {
    return commitSave()
  }
}

async function commitSave() {
  confirmCounts.value = null
  saving.value = true
  try {
    const updates = changedIds.value.map(id => ({ id, enabled: draft.value[id] }))
    await groupStore.bulkUpdateIotEnabled(updates)
    notify.success('구역 표시 설정 저장', `${updates.length}개 구역의 표시 여부가 변경되었습니다.`)
    emit('close')
  } catch (err: any) {
    notify.error('저장 실패', err?.response?.data?.message || '구역 표시 설정 저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
}

function onCloseAttempt() {
  if (hasChanges.value) {
    if (!window.confirm('저장하지 않은 변경이 있습니다. 닫으시겠습니까?')) return
  }
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: var(--overlay, rgba(0,0,0,0.45));
  display: flex; align-items: center; justify-content: center;
  z-index: 1100; padding: 16px;
}
.visibility-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%; max-width: 560px;
  box-shadow: var(--shadow-modal, 0 12px 32px rgba(0,0,0,0.18));
  display: flex; flex-direction: column;
  max-height: 88vh;
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border-light);
}
.modal-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.close-btn {
  background: none; border: none; font-size: 18px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; border-radius: 8px;
}
.close-btn:hover { background: var(--bg-hover); }

.modal-desc {
  padding: 14px 20px 4px;
  font-size: 13px; color: var(--text-secondary);
  line-height: 1.55; margin: 0;
}
.modal-desc strong { color: var(--text-primary); font-weight: 700; }

.house-list { list-style: none; margin: 0; padding: 6px 12px; overflow-y: auto; }
.empty { text-align: center; padding: 28px; color: var(--text-muted); }

.house-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 8px;
  border-bottom: 1px solid var(--border-light);
}
.house-row:last-child { border-bottom: none; }
.house-row.off .row-title,
.house-row.off .row-sub { color: var(--text-muted); }

/* 구역 순서 드래그 */
.house-row.reorderable { position: relative; padding-left: 34px; }
.drag-grip {
  position: absolute;
  left: 6px; top: 0; bottom: 0;
  width: 16px; height: 22px; margin: auto 0;
  cursor: grab; touch-action: none;
  color: var(--text-muted); opacity: 0.7;
  background-image:
    radial-gradient(currentColor 1.3px, transparent 1.6px),
    radial-gradient(currentColor 1.3px, transparent 1.6px);
  background-size: 5px 7px;
  background-position: 3px 2px, 8px 2px;
  background-repeat: repeat-y;
}
.drag-grip:hover { opacity: 1; }
.house-row.dragging {
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.16);
  background: var(--bg-card);
  border-radius: 10px;
  pointer-events: none;
  user-select: none;
}
.reorder-hint {
  font-size: var(--font-size-caption, 12px);
  color: var(--text-muted);
  text-align: center;
  padding: 6px 12px 2px;
  user-select: none;
}

.row-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--bg-hover);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0; color: var(--text-secondary);
}
.row-main { flex: 1; min-width: 0; }
.row-title { font-weight: 700; font-size: 15px; color: var(--text-primary); }
.row-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

/* 토글 */
.toggle-wrap {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  cursor: pointer; user-select: none;
}
.toggle-wrap.disabled { cursor: not-allowed; opacity: 0.6; }
.toggle-wrap input { display: none; }
.track {
  width: 42px; height: 24px;
  background: var(--bg-hover);
  border: 1px solid var(--border-card);
  border-radius: 999px;
  position: relative;
  transition: background 0.15s, border-color 0.15s;
}
.thumb {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
  transition: left 0.15s;
}
.toggle-wrap input:checked + .track {
  background: var(--accent);
  border-color: var(--accent);
}
.toggle-wrap input:checked + .track .thumb { left: 22px; }
.toggle-label {
  font-size: 11px; font-weight: 700;
  color: var(--text-muted);
}

.readonly-hint {
  text-align: center; padding: 6px 0 0;
  font-size: 12px; color: var(--warning-text, var(--text-muted));
}

.modal-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--border-light);
}
.btn-ghost {
  background: var(--bg-hover); border: none; border-radius: 10px;
  padding: 10px 18px; color: var(--text-secondary); font-weight: 600; cursor: pointer;
}
.btn-primary {
  background: var(--accent); color: #fff;
  border: none; border-radius: 10px;
  padding: 10px 22px; font-weight: 700; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* 확인 다이얼로그 */
.confirm-layer { z-index: 1200; background: rgba(0,0,0,0.55); }
.confirm-modal {
  background: var(--bg-card);
  border-radius: 14px;
  max-width: 440px; width: 100%;
  padding: 22px;
  box-shadow: var(--shadow-modal, 0 12px 32px rgba(0,0,0,0.25));
}
.confirm-modal h3 { margin: 0 0 8px; font-size: 17px; }
.confirm-modal p { font-size: 13px; color: var(--text-secondary); margin: 6px 0; }
.confirm-list { margin: 12px 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.confirm-list li {
  background: var(--bg-hover);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  display: flex; flex-direction: column; gap: 2px;
}
.confirm-list .meta { font-size: 12px; color: var(--text-muted); }
.confirm-modal .note { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.btn-danger {
  background: var(--danger); color: #fff;
  border: none; border-radius: 10px;
  padding: 10px 22px; font-weight: 700; cursor: pointer;
}

@media (max-width: 600px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .visibility-modal {
    max-width: 100%;
    border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    max-height: 92vh;
  }
  .confirm-modal { max-width: 100%; border-radius: 18px 18px 0 0; }
  .confirm-layer { align-items: flex-end; padding: 0; }
}
</style>
