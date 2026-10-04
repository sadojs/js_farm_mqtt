<template>
  <!--
    기존 화면 임베드 래퍼(<LegacyView>). frontend/src 의 화면 컴포넌트를 수정 없이 그대로 렌더한다.
    .legacy-scope 안에서만 렌더되므로 콘솔 셸(c-*) 스타일과 분리된다. .main-content 는 기존 본문 글꼴 규칙용(styles/legacy-theme.css).
  -->
  <div class="legacy-scope main-content" :data-legacy="String(route.name || '')">
    <component :is="view" v-if="view" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, markRaw, type Component } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const cache = new WeakMap<object, Component>()

const view = computed<Component | null>(() => {
  const loader = route.meta.legacy
  if (!loader) return null
  if (!cache.has(loader)) cache.set(loader, markRaw(defineAsyncComponent(loader as any)))
  return cache.get(loader) ?? null
})
</script>
