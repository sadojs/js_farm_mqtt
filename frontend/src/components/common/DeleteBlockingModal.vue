<template>
  <div v-if="show" class="blocking-overlay" @click="emit('close')">
    <div
      class="blocking-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label="삭제 불가"
      @click.stop
    >
      <div class="blocking-icon">&#x26A0;&#xFE0F;</div>
      <h3 class="blocking-title">삭제할 수 없습니다</h3>

      <!-- 자동화 룰 섹션 -->
      <template v-if="rules.length > 0">
        <p class="blocking-desc">
          <strong>"{{ targetName }}"</strong>{{ subjectLabel }}
          다음 자동화 룰에서 사용 중입니다:
        </p>
        <ul class="rule-list">
          <li v-for="rule in rules" :key="rule.id" class="rule-item">
            <span class="rule-name">{{ rule.name }}</span>
            <span class="rule-badge" :class="rule.enabled ? 'active' : 'inactive'">
              {{ rule.enabled ? '활성' : '비활성' }}
            </span>
          </li>
        </ul>
      </template>

      <!-- 그룹 섹션 -->
      <template v-if="groups && groups.length > 0">
        <p class="blocking-desc" :class="{ 'mt-section': rules.length > 0 }">
          <template v-if="rules.length === 0">
            <strong>"{{ targetName }}"</strong>은(는) 다음 그룹에 포함되어 있습니다:
          </template>
          <template v-else>
            또한 다음 그룹에도 속해 있습니다:
          </template>
        </p>
        <ul class="group-list">
          <li v-for="group in groups" :key="group.id" class="group-item">
            <span class="group-name">{{ group.name }}</span>
          </li>
        </ul>
      </template>

      <p class="blocking-guide">{{ blockingGuide }}</p>

      <div class="blocking-actions">
        <button class="btn-navigate" @click="handleNavigate">
          {{ navigateLabel }}
        </button>
        <button class="btn-close" @click="emit('close')">
          닫기
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { DependencyRule } from '../../types/device.types'

const props = defineProps<{
  show: boolean
  type: 'device' | 'opener-pair' | 'group'
  targetName: string
  rules: DependencyRule[]
  groups?: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()

const subjectLabel = computed(() => {
  if (props.type === 'opener-pair') return '의 열림/닫힘 장비 중 하나 이상이'
  if (props.type === 'group') return '은(는) 대상 그룹으로 지정되어'
  return '은(는)'
})

const groupsOnly = computed(() =>
  props.rules.length === 0 && (props.groups?.length ?? 0) > 0
)

const blockingGuide = computed(() => {
  if (groupsOnly.value) {
    return '먼저 그룹에서 장비를 제거한 후 다시 시도해 주세요.'
  }
  return '위 자동화 룰에서 먼저 제거하거나 룰을 삭제한 후 다시 시도해 주세요.'
})

const navigateLabel = computed(() =>
  groupsOnly.value ? '그룹 관리로 이동' : '자동화 관리로 이동'
)

const handleNavigate = () => {
  emit('close')
  router.push(groupsOnly.value ? '/groups' : '/automation')
}
</script>

<style scoped>
.blocking-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
  overscroll-behavior: contain;
}

.blocking-dialog {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 28px 24px 24px;
  max-width: 420px;
  width: 100%;
  box-shadow: var(--shadow-modal);
  border: 1px solid var(--border-color);
  text-align: center;
}

.blocking-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.blocking-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.blocking-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 16px;
}

.rule-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  text-align: left;
  background: var(--bg-hover);
  border-radius: 8px;
  overflow: hidden;
}

.rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  gap: 8px;
}

.rule-item:last-child {
  border-bottom: none;
}

.rule-name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  flex-shrink: 0;
}

.rule-badge.active {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}

.rule-badge.inactive {
  background: var(--border-color);
  color: var(--text-tertiary);
}

.blocking-desc.mt-section {
  margin-top: 16px;
}

.group-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  text-align: left;
  background: var(--bg-hover);
  border-radius: 8px;
  overflow: hidden;
}

.group-item {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
}

.group-item:last-child {
  border-bottom: none;
}

.group-name {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.blocking-guide {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
}

.blocking-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-navigate {
  width: 100%;
  padding: 12px;
  min-height: 44px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  border: none;
  background: var(--accent);
  color: white;
  transition: background 0.2s, transform 0.1s;
}

.btn-navigate:hover {
  background: var(--accent-hover);
}

.btn-navigate:active {
  transform: scale(0.98);
}

.btn-navigate:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn-close {
  width: 100%;
  padding: 12px;
  min-height: 44px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  border: none;
  background: var(--bg-hover);
  color: var(--text-primary);
  transition: background 0.2s, transform 0.1s;
}

.btn-close:hover {
  background: var(--border-color);
}

.btn-close:active {
  transform: scale(0.98);
}

.btn-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
