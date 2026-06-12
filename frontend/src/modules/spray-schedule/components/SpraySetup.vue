<template>
  <div class="spray-setup">
    <div class="farm-row">
      <label>농장</label>
      <div class="farm-display">{{ farmLabel }}</div>
    </div>

    <p class="setup-hint">
      구역마다 정식일과 방재 프로그램을 입력하면 달력에 모든 구역 일정이 자동 생성됩니다.
    </p>

    <div v-for="(zone, zi) in zones" :key="zone.key" class="zone-card">
      <!-- 구역 헤더 -->
      <div class="zone-head">
        <button
          class="color-dot"
          :style="{ background: zone.color }"
          title="구역 색 변경"
          @click="cycleZoneColor(zone)"
        ></button>
        <input v-model="zone.name" class="inp zone-name" placeholder="구역명 (예: 석문리 1호 하우스)" />
        <input v-model="zone.cropType" class="inp zone-crop" placeholder="작물 (예: 토마토)" />
        <div class="field">
          <span class="field-label">정식일</span>
          <input v-model="zone.transplantDate" type="date" class="inp" />
        </div>
        <button class="btn-icon danger" title="구역 삭제" @click="removeZone(zi)">✕</button>
      </div>

      <!-- 방재 프로그램 목록 -->
      <div class="programs">
        <div class="programs-title">방재 프로그램</div>

        <div
          v-for="(program, pi) in zone.programs"
          :key="program.key"
          class="program-card"
          :style="{ borderColor: program.color, background: tint(program.color) }"
        >
          <div class="program-head">
            <button
              class="color-dot"
              :style="{ background: program.color }"
              title="약종 색 변경"
              @click="cyclePestColor(program)"
            ></button>
            <input v-model="program.pest" class="inp pest-name" placeholder="해충/약종 (예: 총채약)" />
            <span class="program-meta">{{ programSummary(program) }}</span>
            <button class="btn-icon danger" title="방재 종류 삭제" @click="removeProgram(zone, pi)">✕</button>
          </div>

          <!-- 우선순위 약품 행 -->
          <div class="product-rows">
            <div class="product-row product-head-row">
              <span class="col-rank">순위</span>
              <span class="col-name">약품명</span>
              <span class="col-date">시작일</span>
              <span class="col-step">간격</span>
              <span class="col-step">횟수</span>
              <span class="col-bee">벌</span>
              <span class="col-del"></span>
            </div>
            <div
              v-for="(product, pri) in program.products"
              :key="product.key"
              class="product-row"
            >
              <span class="rank-badge" :style="{ background: program.color }">{{ pri + 1 }}</span>
              <input v-model="product.name" class="inp col-name" placeholder="약품명" />
              <input v-model="product.startDate" type="date" class="inp col-date" />
              <div class="stepper col-step">
                <button @click="product.intervalDays = Math.max(1, product.intervalDays - 1)">−</button>
                <span class="num">{{ product.intervalDays }}<small>일</small></span>
                <button @click="product.intervalDays = product.intervalDays + 1">+</button>
              </div>
              <div class="stepper col-step">
                <button @click="product.count = Math.max(1, product.count - 1)">−</button>
                <span class="num">{{ product.count }}<small>회</small></span>
                <button @click="product.count = product.count + 1">+</button>
              </div>
              <label
                class="col-bee bee-check"
                :class="{ on: product.hasBees }"
                title="벌(호박벌) 사용 — 방재일 오전 벌문 닫기 + 방재 2일 후 벌문 개방 일정 자동 추가"
              >
                <input type="checkbox" v-model="product.hasBees" />
                <span>🐝 벌</span>
              </label>
              <button class="btn-icon danger col-del" title="약품 삭제" @click="removeProduct(program, pri)">−</button>
            </div>
          </div>

          <button class="btn-add-inline" @click="addProduct(zone, program)">+ 우선순위 약품 추가</button>
        </div>

        <button class="btn-add-program" @click="addProgram(zone)">+ 방재 종류 추가</button>
      </div>

      <p class="zone-note">
        각 약품 시작일 기본값은 구역 정식일입니다. 방재 종류가 늘면 시작일을 조정해 겹침을 피할 수 있습니다.
      </p>

      <div class="zone-actions">
        <button class="btn-save" :disabled="zone.saving" @click="saveZone(zone)">
          {{ zone.saving ? '저장 중…' : '이 구역 저장' }}
        </button>
      </div>
    </div>

    <button class="btn-add-zone" @click="addZone">+ 구역 추가</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../../../stores/auth.store'
import { useNotificationStore } from '../../../stores/notification.store'
import { sprayScheduleApi } from '../api/spray-schedule.api'
import {
  PEST_COLOR_PRESETS,
  ZONE_COLOR_PRESETS,
} from '../types/spray-schedule.types'
import type { SprayZone } from '../types/spray-schedule.types'
import { computeDefaultStart, todayStr } from '../utils/spray-schedule.utils'

const emit = defineEmits<{ (e: 'changed'): void }>()

const authStore = useAuthStore()
const notify = useNotificationStore()

const farmLabel = `${authStore.user?.name ?? '우리'} 농장`

let keySeq = 0
const nextKey = () => `k${keySeq++}`

interface ProductDraft {
  key: string
  id?: string
  name: string
  startDate: string
  intervalDays: number
  count: number
  hasBees: boolean
}
interface ProgramDraft {
  key: string
  id?: string
  pest: string
  color: string
  products: ProductDraft[]
}
interface ZoneDraft {
  key: string
  id?: string
  name: string
  cropType: string
  transplantDate: string
  color: string
  programs: ProgramDraft[]
  saving: boolean
}

const zones = ref<ZoneDraft[]>([])

function toDraft(z: SprayZone): ZoneDraft {
  return {
    key: nextKey(),
    id: z.id,
    name: z.name,
    cropType: z.cropType ?? '',
    transplantDate: z.transplantDate?.slice(0, 10) ?? todayStr(),
    color: z.color,
    programs: (z.programs ?? []).map((p) => ({
      key: nextKey(),
      id: p.id,
      pest: p.pest,
      color: p.color,
      products: (p.products ?? []).map((pr) => ({
        key: nextKey(),
        id: pr.id,
        name: pr.name,
        startDate: pr.startDate?.slice(0, 10) ?? z.transplantDate?.slice(0, 10),
        intervalDays: pr.intervalDays,
        count: pr.count,
        hasBees: pr.hasBees ?? false,
      })),
    })),
    saving: false,
  }
}

async function load() {
  const list = await sprayScheduleApi.getZones()
  zones.value = list.map(toDraft)
}

function addZone() {
  zones.value.push({
    key: nextKey(),
    name: '',
    cropType: '',
    transplantDate: todayStr(),
    color: ZONE_COLOR_PRESETS[zones.value.length % ZONE_COLOR_PRESETS.length],
    programs: [],
    saving: false,
  })
}

function removeZone(index: number) {
  const zone = zones.value[index]
  if (zone.id) {
    if (!confirm('이 구역과 관련 방재 일정을 모두 삭제할까요?')) return
    sprayScheduleApi
      .deleteZone(zone.id)
      .then(() => {
        zones.value.splice(index, 1)
        notify.info('방재일정', '구역을 삭제했습니다.')
        emit('changed')
      })
      .catch(() => notify.error('방재일정', '구역 삭제에 실패했습니다.'))
  } else {
    zones.value.splice(index, 1)
  }
}

function addProgram(zone: ZoneDraft) {
  const preset = PEST_COLOR_PRESETS[zone.programs.length % PEST_COLOR_PRESETS.length]
  zone.programs.push({
    key: nextKey(),
    pest: preset.label === '기타' ? '' : preset.label,
    color: preset.color,
    products: [],
  })
}

function removeProgram(zone: ZoneDraft, index: number) {
  zone.programs.splice(index, 1)
}

function addProduct(zone: ZoneDraft, program: ProgramDraft) {
  const idx = program.products.length
  const startDate = computeDefaultStart(
    program.products as any,
    idx,
    zone.transplantDate,
  )
  program.products.push({
    key: nextKey(),
    name: '',
    startDate,
    intervalDays: 3,
    count: 3,
    hasBees: false,
  })
}

function removeProduct(program: ProgramDraft, index: number) {
  program.products.splice(index, 1)
}

function cycleZoneColor(zone: ZoneDraft) {
  const i = ZONE_COLOR_PRESETS.indexOf(zone.color)
  zone.color = ZONE_COLOR_PRESETS[(i + 1) % ZONE_COLOR_PRESETS.length]
}

function cyclePestColor(program: ProgramDraft) {
  const colors = PEST_COLOR_PRESETS.map((p) => p.color)
  const i = colors.indexOf(program.color)
  program.color = colors[(i + 1) % colors.length]
}

function programSummary(program: ProgramDraft): string {
  const totalCount = program.products.reduce((s, p) => s + p.count, 0)
  return `${totalCount}회 · 약품 ${program.products.length}종 회전`
}

function tint(hex: string): string {
  return `${hex}14`
}

async function saveZone(zone: ZoneDraft) {
  if (!zone.name.trim()) {
    notify.warning('방재일정', '구역명을 입력해 주세요.')
    return
  }
  zone.saving = true
  try {
    const saved = await sprayScheduleApi.saveZone({
      id: zone.id,
      name: zone.name.trim(),
      cropType: zone.cropType.trim() || undefined,
      transplantDate: zone.transplantDate,
      color: zone.color,
      programs: zone.programs.map((p, pi) => ({
        id: p.id,
        pest: p.pest.trim(),
        color: p.color,
        sortOrder: pi,
        products: p.products.map((pr, pri) => ({
          id: pr.id,
          rank: pri + 1,
          name: pr.name.trim(),
          startDate: pr.startDate,
          intervalDays: pr.intervalDays,
          count: pr.count,
          hasBees: pr.hasBees,
        })),
      })),
    })
    zone.id = saved.id
    notify.success('방재일정', '구역 일정을 저장했습니다.')
    emit('changed')
    await load()
  } catch {
    notify.error('방재일정', '저장에 실패했습니다.')
  } finally {
    zone.saving = false
  }
}

onMounted(load)
defineExpose({ reload: load })
</script>

<style scoped>
.spray-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.farm-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.farm-row label {
  font-weight: 600;
  color: var(--text-secondary);
}
.farm-display {
  padding: 10px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 10px;
  color: var(--text-primary);
  font-weight: 600;
  min-width: 220px;
}
.setup-hint {
  color: var(--text-muted);
  font-size: var(--font-size-label);
}
.zone-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.zone-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.inp {
  padding: 9px 12px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-label);
}
.inp:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.zone-name { flex: 1; min-width: 160px; }
.zone-crop { width: 150px; }
.field { display: flex; align-items: center; gap: 6px; }
.field-label { font-size: var(--font-size-caption); color: var(--text-muted); }
.programs { display: flex; flex-direction: column; gap: 10px; }
.programs-title { font-weight: 600; color: var(--text-secondary); font-size: var(--font-size-label); }
.program-card {
  border: 1px solid;
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.program-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pest-name { width: 160px; min-width: 0; font-weight: 600; }
.program-meta { color: var(--text-muted); font-size: var(--font-size-caption); }
.btn-icon {
  margin-left: auto;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-input);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.btn-icon.danger:hover { background: var(--danger-bg); color: var(--danger); border-color: var(--danger); }
.product-rows { display: flex; flex-direction: column; gap: 6px; }
.product-row {
  display: grid;
  grid-template-columns: 44px 1fr 140px 108px 108px 64px 34px;
  gap: 8px;
  align-items: center;
}
.product-head-row span { font-size: var(--font-size-caption); color: var(--text-muted); }
.col-del { margin-left: 0; }
.col-bee { text-align: center; }
.bee-check {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  padding: 6px 4px;
  cursor: pointer;
  font-size: var(--font-size-caption);
  color: var(--text-muted);
  white-space: nowrap;
  user-select: none;
}
.bee-check input { cursor: pointer; }
.bee-check.on { border-color: var(--warning); background: var(--warning-bg); color: var(--warning-text); font-weight: 600; }
.rank-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--border-input);
  border-radius: 8px;
  background: var(--bg-input);
  overflow: hidden;
}
.stepper button {
  width: 32px;
  height: 34px;
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}
.stepper .num {
  flex: 1;
  text-align: center;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.stepper small { color: var(--text-muted); margin-left: 2px; font-weight: 400; }
.btn-add-inline, .btn-add-program, .btn-add-zone {
  align-self: flex-start;
  background: none;
  border: 1px dashed var(--accent);
  color: var(--accent);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-weight: 600;
  font-size: var(--font-size-label);
}
.btn-add-inline:hover, .btn-add-program:hover, .btn-add-zone:hover { background: var(--accent-bg); }
.btn-add-zone { align-self: center; padding: 12px 24px; }
.zone-note { color: var(--text-muted); font-size: var(--font-size-caption); }
.zone-actions { display: flex; justify-content: flex-end; }
.btn-save {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 600;
  cursor: pointer;
}
.btn-save:hover { background: var(--accent-hover); }
.btn-save:disabled { opacity: 0.6; cursor: default; }
@media (max-width: 768px) {
  .product-head-row { display: none; }
  .product-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .product-row .inp { min-width: 0; }
  .product-row .col-name { flex: 1 1 120px; }
  .product-row .col-date { flex: 1 1 120px; }
  .product-row .stepper { flex: 1 1 90px; }
  .product-row .col-bee { flex: 0 0 auto; }
  .product-row .col-del { flex: 0 0 auto; }
  .zone-crop { flex: 1 1 120px; width: auto; }
  .zone-name { flex: 1 1 100%; }
}
</style>
