<template>
  <!--
    기존 화면 임베드 래퍼(<LegacyView>). frontend/src 의 화면 컴포넌트를 수정 없이 그대로 렌더한다.
    .legacy-scope 안에서만 렌더되므로 콘솔 셸(c-*) 스타일과 분리된다. .main-content 는 기존 본문 글꼴 규칙용(styles/legacy-theme.css).
  -->
  <div ref="host" class="legacy-scope main-content" :data-legacy="String(route.name || '')" @click.capture="guardDangerous">
    <component :is="view" v-if="view" />
  </div>

  <!-- 비상 정지 2단계 확인 (FEATURE_PARITY G8) — 기존 화면의 1단계 confirm() 앞에 콘솔 확인을 끼운다 -->
  <div v-if="stopAsk" class="c-modal-back" @click.self="stopAsk = null">
    <div class="c-modal" role="alertdialog" aria-modal="true" aria-label="비상 정지 최종 확인">
      <div class="c-modal-h" style="color:var(--c-bad-fg)">비상 정지 — 최종 확인</div>
      <div class="c-modal-b">
        <p style="margin:0"><b>{{ stopAsk.target }}</b> 게이트웨이의 <b>모든 릴레이가 즉시 꺼집니다</b>. 관수 · 환기 · 개폐기 동작이 멈춥니다.</p>
        <div class="c-form-row">
          <label for="legacy-estop">계속하려면 <b>비상 정지</b> 를 그대로 입력하세요</label>
          <input id="legacy-estop" v-model="stopTyped" class="c-input" autocomplete="off" spellcheck="false" />
        </div>
      </div>
      <div class="c-modal-f">
        <button class="c-btn" type="button" @click="stopAsk = null">취소</button>
        <button class="c-btn c-btn-danger" type="button" :disabled="stopTyped.trim() !== '비상 정지'" @click="proceedStop">계속</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, markRaw, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { useConfirm } from '@/composables/useConfirm'

const route = useRoute()
const { confirm } = useConfirm()
const cache = new WeakMap<object, Component>()
const host = ref<HTMLElement | null>(null)

const view = computed<Component | null>(() => {
  const loader = route.meta.legacy
  if (!loader) return null
  if (!cache.has(loader)) cache.set(loader, markRaw(defineAsyncComponent(loader as any)))
  return cache.get(loader) ?? null
})

/**
 * 기존 이머전시 페일오버 화면의 "비상 정지" 버튼(FailoverStatusCard .btn-danger)은 confirm() 1회만 묻는다.
 * 콘솔에서는 클릭을 먼저 가로채 (1) 확인 다이얼로그 (2) 문구 입력을 거친 뒤에만 원래 버튼을 다시 눌러
 * 기존 흐름(기존 confirm → API)을 그대로 이어간다. 기존 코드는 수정하지 않는다.
 */
const stopAsk = ref<{ button: HTMLElement; target: string } | null>(null)
const stopTyped = ref('')
let passThrough: HTMLElement | null = null

function isEmergencyStopButton(el: HTMLElement | null): HTMLElement | null {
  const btn = el?.closest('button')
  if (!btn || route.name !== 'emergency-failover') return null
  return btn.classList.contains('btn-danger') && btn.textContent?.trim() === '비상 정지' ? btn : null
}

async function guardDangerous(e: MouseEvent) {
  const btn = isEmergencyStopButton(e.target as HTMLElement)
  if (!btn) return
  if (passThrough === btn) {
    passThrough = null
    return
  }
  e.preventDefault()
  e.stopPropagation()
  const select = host.value?.querySelector('select') as HTMLSelectElement | null
  const target = select?.selectedOptions[0]?.textContent?.trim() || '선택한'
  const ok = await confirm({ title: '비상 정지', message: `${target} 게이트웨이의 모든 릴레이를 비상 정지하시겠습니까? 폴백 모드에서도 즉시 실행됩니다.`, confirmText: '다음', variant: 'danger' })
  if (!ok) return
  stopTyped.value = ''
  stopAsk.value = { button: btn, target }
}

function proceedStop() {
  const ask = stopAsk.value
  if (!ask || stopTyped.value.trim() !== '비상 정지') return
  stopAsk.value = null
  passThrough = ask.button
  ask.button.click()
}
</script>
