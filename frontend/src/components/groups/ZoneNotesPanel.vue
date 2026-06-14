<template>
  <div v-if="show" class="zn-overlay" @click.self="$emit('close')">
    <aside class="zn-panel">
      <!-- 헤더 -->
      <div class="zn-head">
        <div class="zn-title">
          <span class="zn-doc">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          </span>
          <div>
            <h3>구역 메모</h3>
            <p class="zn-sub">{{ zoneName }} · {{ notes.length }}개</p>
          </div>
        </div>
        <button class="zn-close" @click="$emit('close')" aria-label="닫기">✕</button>
      </div>

      <!-- 목록 -->
      <div v-if="mode === 'list'" class="zn-body">
        <div v-if="loading" class="zn-state">불러오는 중…</div>
        <div v-else-if="notes.length === 0" class="zn-state">
          아직 메모가 없습니다. 다음 작기 참고용 특징·노하우를 남겨보세요.
        </div>
        <ul v-else class="zn-list">
          <li
            v-for="n in notes"
            :key="n.id"
            class="zn-item"
            :class="{ pinned: n.pinned }"
            :style="n.pinned ? { background: tag(n.tag).bg } : {}"
            @click="openEdit(n)"
          >
            <span class="zn-tag" :style="{ background: tag(n.tag).bg, color: tag(n.tag).color }">
              {{ tag(n.tag).emoji }} {{ tag(n.tag).label }}
            </span>
            <p class="zn-text">{{ n.text }}</p>
            <p class="zn-meta">
              <span v-if="n.pinned" class="zn-pin">📌 고정</span>
              {{ n.createdByName || '작성자' }} · {{ fmtDate(n.createdAt) }}
            </p>
          </li>
        </ul>
      </div>

      <!-- 추가/편집 폼 -->
      <div v-else class="zn-body">
        <div class="zn-field">
          <label>분류</label>
          <div class="zn-tag-grid">
            <button
              v-for="t in ZONE_NOTE_TAGS"
              :key="t.key"
              type="button"
              class="zn-tag-btn"
              :class="{ on: form.tag === t.key }"
              :style="form.tag === t.key ? { background: t.bg, color: t.color, borderColor: t.color } : {}"
              @click="form.tag = t.key"
            >{{ t.emoji }} {{ t.label }}</button>
          </div>
        </div>
        <div class="zn-field">
          <label>내용</label>
          <textarea
            v-model="form.text"
            rows="4"
            maxlength="1000"
            class="zn-textarea"
            placeholder="예: 물 빠짐이 좋아 관수 40분 필요 (기본 25분 → +15분)"
          ></textarea>
        </div>
        <label class="zn-toggle-row">
          <span>상단 고정 <small>(패널에서 위로 정렬)</small></span>
          <span class="zn-switch" :class="{ on: form.pinned }" @click="form.pinned = !form.pinned">
            <span class="zn-knob"></span>
          </span>
        </label>
      </div>

      <!-- 푸터 -->
      <div class="zn-foot">
        <template v-if="mode === 'list'">
          <button class="zn-add" @click="openAdd">+ 메모 추가</button>
        </template>
        <template v-else>
          <button v-if="editing" class="zn-del" :disabled="busy" @click="onDelete">🗑 삭제</button>
          <div class="zn-foot-right">
            <button class="zn-ghost" :disabled="busy" @click="backToList">취소</button>
            <button class="zn-save" :disabled="busy || !form.text.trim()" @click="onSave">
              {{ busy ? '저장 중…' : '저장' }}
            </button>
          </div>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { zoneNotesApi } from '../../api/zone-notes.api'
import { ZONE_NOTE_TAGS, zoneNoteTagMeta } from '../../types/zone-note.types'
import type { ZoneNote, ZoneNoteTag } from '../../types/zone-note.types'

const props = defineProps<{ show: boolean; zoneId: string; zoneName: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

const notes = ref<ZoneNote[]>([])
const loading = ref(false)
const busy = ref(false)
const mode = ref<'list' | 'form'>('list')
const editing = ref<ZoneNote | null>(null)
const form = reactive<{ tag: ZoneNoteTag; text: string; pinned: boolean }>({
  tag: 'etc',
  text: '',
  pinned: false,
})

const tag = zoneNoteTagMeta

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

async function load() {
  if (!props.zoneId) return
  loading.value = true
  try {
    const res = await zoneNotesApi.list(props.zoneId)
    notes.value = res.data
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      mode.value = 'list'
      editing.value = null
      load()
    }
  },
)

function openAdd() {
  editing.value = null
  form.tag = 'etc'
  form.text = ''
  form.pinned = false
  mode.value = 'form'
}
function openEdit(n: ZoneNote) {
  editing.value = n
  form.tag = n.tag
  form.text = n.text
  form.pinned = n.pinned
  mode.value = 'form'
}
function backToList() {
  mode.value = 'list'
  editing.value = null
}

async function onSave() {
  if (!form.text.trim()) return
  busy.value = true
  try {
    if (editing.value) {
      await zoneNotesApi.update(editing.value.id, {
        tag: form.tag,
        text: form.text.trim(),
        pinned: form.pinned,
      })
    } else {
      await zoneNotesApi.create({
        zoneId: props.zoneId,
        tag: form.tag,
        text: form.text.trim(),
        pinned: form.pinned,
      })
    }
    await load()
    emit('changed')
    backToList()
  } catch (e: any) {
    alert(e?.response?.data?.message || '저장에 실패했습니다.')
  } finally {
    busy.value = false
  }
}

async function onDelete() {
  if (!editing.value) return
  if (!confirm('이 메모를 삭제하시겠습니까?')) return
  busy.value = true
  try {
    await zoneNotesApi.remove(editing.value.id)
    await load()
    emit('changed')
    backToList()
  } catch {
    alert('삭제에 실패했습니다.')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.zn-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 1100;
  display: flex; justify-content: flex-end;
}
.zn-panel {
  width: 410px; max-width: 100%;
  height: 100%;
  background: var(--bg-card);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal);
  animation: zn-slide 0.22s ease;
}
@keyframes zn-slide { from { transform: translateX(20px); opacity: 0.6; } to { transform: none; opacity: 1; } }

.zn-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border-light);
}
.zn-title { display: flex; align-items: center; gap: 12px; }
.zn-doc {
  width: 38px; height: 38px; border-radius: 11px;
  background: var(--accent-bg); color: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
}
.zn-doc svg { width: 20px; height: 20px; }
.zn-head h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); }
.zn-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
.zn-close {
  width: 34px; height: 34px; border: none; background: var(--bg-hover);
  border-radius: 8px; color: var(--text-muted); cursor: pointer; font-size: 16px;
}
.zn-close:hover { background: var(--border-light); }

.zn-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.zn-state { text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 14px; line-height: 1.5; }

.zn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.zn-item {
  border: 1px solid var(--border-light); border-radius: 12px;
  padding: 12px 14px; cursor: pointer; background: var(--bg-card);
  display: flex; flex-direction: column; gap: 6px;
}
.zn-item:hover { border-color: var(--accent); }
.zn-tag {
  align-self: flex-start;
  font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 10px;
}
.zn-text { margin: 0; color: var(--text-primary); font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.zn-meta { margin: 0; font-size: 11.5px; color: var(--text-muted); }
.zn-pin { margin-right: 6px; color: var(--warning-text); font-weight: 700; }

.zn-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.zn-field label { font-size: 13px; font-weight: 700; color: var(--text-secondary); }
.zn-tag-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.zn-tag-btn {
  border: 1px solid var(--border-input); background: var(--bg-input);
  color: var(--text-secondary); border-radius: 999px;
  padding: 8px 14px; font-weight: 600; font-size: 13px; cursor: pointer; min-height: 40px;
}
.zn-textarea {
  width: 100%; box-sizing: border-box; resize: vertical;
  border: 1px solid var(--border-input); border-radius: 12px;
  background: var(--bg-input); color: var(--text-primary);
  padding: 12px; font-size: 14px; font-family: inherit; line-height: 1.5;
}
.zn-textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.zn-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 14px; color: var(--text-primary); font-weight: 600;
}
.zn-toggle-row small { color: var(--text-muted); font-weight: 400; }
.zn-switch {
  width: 46px; height: 26px; border-radius: 999px;
  background: var(--toggle-off); position: relative; cursor: pointer; transition: background 0.15s; flex-shrink: 0;
}
.zn-switch.on { background: var(--toggle-on); }
.zn-knob {
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.15s;
}
.zn-switch.on .zn-knob { left: 23px; }

.zn-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 14px 18px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border-light);
}
.zn-foot-right { display: flex; gap: 8px; margin-left: auto; }
.zn-add {
  width: 100%; background: var(--accent); color: #fff; border: none;
  border-radius: 12px; padding: 13px; font-weight: 700; font-size: 15px; cursor: pointer; min-height: 48px;
}
.zn-add:hover { background: var(--accent-hover); }
.zn-del {
  border: 1px solid var(--danger); background: var(--danger-bg); color: var(--danger);
  border-radius: 10px; padding: 10px 16px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.zn-del:hover { background: var(--danger); color: #fff; }
.zn-ghost {
  background: var(--bg-hover); border: none; border-radius: 10px;
  padding: 10px 16px; color: var(--text-secondary); font-weight: 600; cursor: pointer; min-height: 44px;
}
.zn-save {
  background: var(--accent); color: #fff; border: none; border-radius: 10px;
  padding: 10px 22px; font-weight: 700; cursor: pointer; min-height: 44px;
}
.zn-save:hover { background: var(--accent-hover); }
.zn-save:disabled, .zn-del:disabled { opacity: 0.6; cursor: default; }

/* 모바일 = 바텀시트 */
@media (max-width: 600px) {
  .zn-overlay { align-items: flex-end; justify-content: center; }
  .zn-panel {
    width: 100%; height: auto; max-height: 88vh;
    border-radius: 18px 18px 0 0;
    animation: zn-up 0.24s ease;
  }
  @keyframes zn-up { from { transform: translateY(24px); } to { transform: none; } }
}
</style>
