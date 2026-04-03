import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { automationApi } from '../api/automation.api'
import type { IrrigationDeviceStatus } from '../api/automation.api'
import type { AutomationRule, CreateRuleRequest } from '../types/automation.types'

export const useAutomationStore = defineStore('automation', () => {
  const rules = ref<AutomationRule[]>([])
  const loading = ref(false)
  const irrigationStatus = ref<IrrigationDeviceStatus[]>([])

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

  async function toggleRule(id: string, options?: { autoEnableRemote?: boolean }) {
    const params = options?.autoEnableRemote ? '?autoEnableRemote=true' : ''
    await automationApi.toggleRule(id, params)
    const rule = rules.value.find(r => r.id === id)
    if (rule) {
      rule.enabled = !rule.enabled
    }
  }

  async function removeRule(id: string) {
    await automationApi.removeRule(id)
    rules.value = rules.value.filter(r => r.id !== id)
  }

  async function fetchIrrigationStatus() {
    try {
      const { data } = await automationApi.getIrrigationStatus()
      irrigationStatus.value = data
    } catch {
      // 실패 시 무시
    }
  }

  async function bulkDisableByDevice(deviceId: string) {
    const { data } = await automationApi.bulkDisableByDevice(deviceId)
    // 로컬 상태 반영
    rules.value.forEach(rule => {
      if ((rule.conditions as any)?.type === 'irrigation') {
        const actions = rule.actions as any
        const ids: string[] = []
        if (actions?.targetDeviceId) ids.push(actions.targetDeviceId)
        if (Array.isArray(actions?.targetDeviceIds)) ids.push(...actions.targetDeviceIds)
        if (ids.includes(deviceId)) {
          rule.enabled = false
        }
      }
    })
    return data
  }

  function getDeviceIrrigationStatus(deviceId: string) {
    return irrigationStatus.value.find(s => s.deviceId === deviceId)
  }

  return {
    rules,
    loading,
    irrigationStatus,
    enabledRules,
    weatherRules,
    timeRules,
    hybridRules,
    fetchRules,
    createRule,
    updateRule,
    toggleRule,
    removeRule,
    fetchIrrigationStatus,
    bulkDisableByDevice,
    getDeviceIrrigationStatus,
  }
})
