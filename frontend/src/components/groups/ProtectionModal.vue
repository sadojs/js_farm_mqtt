<template>
  <div class="prot-overlay" @click.self="$emit('close')">
    <div class="prot-panel">
      <div class="prot-header">
        <h3>🛡 방재 모드</h3>
        <button class="prot-close" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <div class="prot-body">
        <p class="prot-desc">선택한 하우스를 지정 시간 동안 밀폐합니다. 방재 중에는 자동제어가 해당 장치를 제어하지 않으며, 시간이 지나면 자동으로 복귀합니다.</p>

        <!-- STEP 1. 하우스 -->
        <section class="prot-sec">
          <div class="prot-sec-title">1. 하우스 선택</div>
          <select v-model="groupId" class="prot-select">
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </section>

        <!-- STEP 2. 동작 -->
        <section class="prot-sec">
          <div class="prot-sec-title">2. 동작 선택</div>
          <label class="prot-check">
            <input type="checkbox" v-model="closeOpeners" />
            <span>개폐기 닫기</span>
          </label>
          <label class="prot-check">
            <input type="checkbox" v-model="stopFans" />
            <span>유동팬 정지</span>
          </label>
          <p v-if="!closeOpeners && !stopFans" class="prot-warn">하나 이상 선택해야 합니다.</p>
        </section>

        <!-- STEP 3. 시간 -->
        <section class="prot-sec">
          <div class="prot-sec-title">3. 방재 시간</div>
          <div class="prot-presets">
            <button v-for="h in [1, 2, 3, 6, 12]" :key="h"
              :class="{ active: !custom && hours === h }"
              @click="selectPreset(h)">{{ h }}시간</button>
            <button :class="{ active: custom }" @click="custom = true">직접</button>
          </div>
          <div v-if="custom" class="prot-custom">
            <input type="number" v-model.number="customMinutes" min="1" max="720" /> 분
            <span class="prot-hint">(최대 720분 = 12시간)</span>
          </div>
        </section>
      </div>

      <div class="prot-footer">
        <button class="prot-btn-cancel" @click="$emit('close')">취소</button>
        <button class="prot-btn-go" :disabled="!canStart || loading" @click="start">
          {{ loading ? '적용 중…' : '방재 시작' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { HouseGroup } from '@/types/group.types'
import { groupApi } from '@/api/group.api'
import { useNotificationStore } from '@/stores/notification.store'

const props = defineProps<{ groups: HouseGroup[]; defaultGroupId?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'started'): void }>()
const notify = useNotificationStore()

const groupId = ref(props.defaultGroupId ?? props.groups[0]?.id ?? '')
const closeOpeners = ref(true)
const stopFans = ref(true)
const hours = ref(2)
const custom = ref(false)
const customMinutes = ref(120)
const loading = ref(false)

const durationMinutes = computed(() => (custom.value ? Math.round(customMinutes.value) : hours.value * 60))
const canStart = computed(() => !!groupId.value && (closeOpeners.value || stopFans.value)
  && durationMinutes.value >= 1 && durationMinutes.value <= 720)

function selectPreset(h: number) { custom.value = false; hours.value = h }

async function start() {
  if (!canStart.value || loading.value) return
  loading.value = true
  try {
    const { data } = await groupApi.startProtection(groupId.value, {
      durationMinutes: durationMinutes.value,
      closeOpeners: closeOpeners.value,
      stopFans: stopFans.value,
    })
    const a = data.applied
    notify.success('방재 시작', `개폐기 ${a.openers} · 유동팬 ${a.fans} — ${Math.round(durationMinutes.value / 60 * 10) / 10}시간 동안 밀폐`)
    emit('started')
    emit('close')
  } catch (e: any) {
    notify.error('방재 실패', e?.response?.data?.message || '방재 시작에 실패했습니다.')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.prot-overlay { position: fixed; inset: 0; background: var(--overlay, rgba(0,0,0,0.45)); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.prot-panel { background: var(--bg-card, #fff); border-radius: 16px; width: 100%; max-width: 440px; max-height: 88vh; overflow-y: auto; box-shadow: var(--shadow-modal, 0 8px 32px rgba(0,0,0,0.2)); }
.prot-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border-light); }
.prot-header h3 { margin: 0; font-size: calc(18px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); }
.prot-close { background: none; border: none; font-size: calc(18px * var(--content-scale, 1)); color: var(--text-muted); cursor: pointer; min-height: 0; }
.prot-body { padding: 16px 20px; }
.prot-desc { font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); line-height: 1.5; margin: 0 0 16px; }
.prot-sec { margin-bottom: 18px; }
.prot-sec-title { font-size: calc(13px * var(--content-scale, 1)); font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
.prot-select { width: 100%; padding: 10px 12px; border: 1px solid var(--border-input); border-radius: 8px; font-size: calc(14px * var(--content-scale, 1)); background: var(--bg-secondary); color: var(--text-primary); }
.prot-check { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: calc(14px * var(--content-scale, 1)); color: var(--text-primary); cursor: pointer; }
.prot-check input { width: 18px; height: 18px; }
.prot-warn { font-size: calc(12px * var(--content-scale, 1)); color: var(--danger, #e53935); margin: 4px 0 0; }
.prot-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.prot-presets button { padding: 8px 14px; border: 1px solid var(--border-input); border-radius: 8px; background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer; font-size: calc(13px * var(--content-scale, 1)); min-height: 0; }
.prot-presets button.active { background: var(--accent, #2e7d32); color: #fff; border-color: var(--accent, #2e7d32); }
.prot-custom { margin-top: 10px; display: flex; align-items: center; gap: 8px; font-size: calc(13px * var(--content-scale, 1)); color: var(--text-secondary); }
.prot-custom input { width: 90px; padding: 8px 10px; border: 1px solid var(--border-input); border-radius: 8px; font-size: calc(14px * var(--content-scale, 1)); background: var(--bg-secondary); color: var(--text-primary); }
.prot-hint { color: var(--text-muted); font-size: calc(11px * var(--content-scale, 1)); }
.prot-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 14px 20px 20px; }
.prot-btn-cancel { padding: 10px 16px; border: 1px solid var(--border-input); border-radius: 8px; background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer; font-size: calc(14px * var(--content-scale, 1)); min-height: 0; }
.prot-btn-go { padding: 10px 18px; border: none; border-radius: 8px; background: #d97706; color: #fff; font-weight: 700; cursor: pointer; font-size: calc(14px * var(--content-scale, 1)); min-height: 0; }
.prot-btn-go:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
