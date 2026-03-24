import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { automationApi } from '../api/automation.api'
import type { AutomationRule, CreateRuleRequest } from '../types/automation.types'

export const useAutomationStore = defineStore('automation', () => {
  const rules = ref<AutomationRule[]>([])
  const loading = ref(false)

  const enabledRules = computed(() => rules.value.filter(r => r.enabled))
  const weatherRules = computed(() => rules.value.filter(r => r.ruleType === 'weather'))
  const timeRules = computed(() => rules.value.filter(r => r.ruleType === 'time'))
  const hybridRules = computed(() => rules.value.filter(r => r.ruleType === 'hybrid'))

  async function fetchRules() {
    loading.value = true
    try {
      const { data } = await automationApi.getRules()
      rules.value = data
    } finally {
      loading.value = false
    }
  }

  async function createRule(payload: CreateRuleRequest) {
    const { data } = await automationApi.createRule(payload)
    await fetchRules()
    return data
  }

  async function updateRule(id: string, payload: Partial<CreateRuleRequest>) {
    const { data } = await automationApi.updateRule(id, payload)
    await fetchRules()
    return data
  }

  async function toggleRule(id: string) {
    await automationApi.toggleRule(id)
    const rule = rules.value.find(r => r.id === id)
    if (rule) {
      rule.enabled = !rule.enabled
    }
  }

  async function removeRule(id: string) {
    await automationApi.removeRule(id)
    rules.value = rules.value.filter(r => r.id !== id)
  }

  return {
    rules,
    loading,
    enabledRules,
    weatherRules,
    timeRules,
    hybridRules,
    fetchRules,
    createRule,
    updateRule,
    toggleRule,
    removeRule,
  }
})
