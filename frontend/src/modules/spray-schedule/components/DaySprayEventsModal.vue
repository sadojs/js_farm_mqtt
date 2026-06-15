<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="day-modal">
      <div class="modal-head">
        <h3>{{ titleText }} <span class="dow">{{ dowText }}</span></h3>
        <button class="close-btn" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <div class="modal-body">
        <p class="count-line">이 날 방재 일정 {{ events.length }}건</p>

        <div v-if="events.length === 0" class="empty">아직 이 날 일정이 없습니다.</div>

        <ul v-else class="event-list">
          <li
            v-for="ev in events"
            :key="ev.id"
            class="event-row"
            :style="{ borderLeftColor: ev.zoneColor || ev.color || '#888' }"
            @click="$emit('select', ev)"
          >
            <span class="row-icon" :style="{ background: tint(ev.color ?? undefined) }">
              <template v-if="ev.kind === 'bee_open'">🐝</template>
              <template v-else-if="ev.isManual">✚</template>
              <template v-else>💧</template>
            </span>
            <div class="row-main">
              <div class="row-title">
                <strong>{{ ev.zoneName }}</strong>
                <span class="row-pest">
                  · {{ ev.pest }}<template v-if="!ev.isManual && ev.kind !== 'bee_open'"> {{ ev.round }}차</template>
                </span>
              </div>
              <div class="row-sub">
                <span v-if="ev.product">약품: {{ ev.product }}</span>
                <span v-if="ev.timeOfDay" class="tag time-tag">{{ ev.timeOfDay === 'am' ? '오전' : '오후' }}</span>
                <span v-if="ev.bee" class="tag bee-tag">🐝 벌문닫기</span>
                <span v-if="ev.kind === 'bee_open'" class="tag bee-tag">벌문 개방</span>
              </div>
              <div v-if="ev.note" class="row-note">메모: {{ ev.note }}</div>
            </div>
            <span class="row-cta">상세 ›</span>
          </li>
        </ul>
      </div>

      <div class="modal-foot">
        <button class="btn-add" @click="$emit('add', date)">+ 이 날 일정 추가</button>
        <button class="btn-ghost" @click="$emit('close')">닫기</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SprayEvent } from '../types/spray-schedule.types'

const props = defineProps<{
  date: string  // YYYY-MM-DD
  events: SprayEvent[]
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'select', ev: SprayEvent): void
  (e: 'add', date: string): void
}>()

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const titleText = computed(() => {
  const [, m, d] = props.date.split('-').map(Number)
  return `${m}월 ${d}일`
})
const dowText = computed(() => {
  const [y, m, d] = props.date.split('-').map(Number)
  return weekdays[new Date(y, m - 1, d).getDay()] + '요일'
})

function tint(hex?: string | null) {
  if (!hex) return 'var(--bg-hover)'
  return hex + '22'
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: var(--overlay);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 16px;
}
.day-modal {
  background: var(--bg-card);
  border-radius: 16px;
  width: 100%; max-width: 480px;
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column;
  max-height: 88vh;
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border-light);
}
.modal-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.dow { margin-left: 8px; font-size: 14px; font-weight: 500; color: var(--text-muted); }
.close-btn {
  background: none; border: none; font-size: 18px; color: var(--text-muted);
  cursor: pointer; width: 32px; height: 32px; border-radius: 8px;
}
.close-btn:hover { background: var(--bg-hover); }

.modal-body { padding: 14px 16px; overflow-y: auto; }
.count-line { margin: 0 4px 10px; font-size: 13px; color: var(--text-muted); }
.empty { text-align: center; padding: 28px; color: var(--text-muted); }

.event-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.event-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-left: 4px solid var(--accent);
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.event-row:hover { background: var(--bg-hover); border-color: var(--accent); }

.row-icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.row-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.row-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px; }
.row-title strong { font-size: 15px; color: var(--text-primary); font-weight: 700; }
.row-pest { color: var(--text-secondary); font-size: 13px; }
.row-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; }
.row-note { color: var(--text-secondary); font-size: 12px; }

.tag {
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 999px; font-size: 11px; font-weight: 600;
}
.time-tag { background: var(--accent-bg); color: var(--accent); }
.bee-tag { background: rgba(251, 192, 45, 0.18); color: #c08400; }

.row-cta { color: var(--accent); font-size: 13px; font-weight: 600; white-space: nowrap; align-self: center; }

.modal-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--border-light);
  flex-wrap: wrap;
}
.btn-add {
  background: var(--accent-bg); color: var(--accent);
  border: 1px dashed var(--accent); border-radius: 10px;
  padding: 10px 16px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.btn-add:hover { background: var(--accent); color: #fff; }
.btn-ghost {
  background: var(--bg-hover); border: none; border-radius: 10px;
  padding: 10px 16px; color: var(--text-secondary); font-weight: 600; cursor: pointer; min-height: 44px;
}

@media (max-width: 600px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .day-modal {
    max-width: 100%; border-radius: 18px 18px 0 0; max-height: 90vh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .modal-foot { flex-direction: column-reverse; }
  .modal-foot > button { width: 100%; }
}
</style>
