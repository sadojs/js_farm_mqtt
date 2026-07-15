import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { groupApi } from '../api/group.api'
import type { HouseGroupWithOwner, House, CreateGroupRequest, CreateHouseRequest } from '../types/group.types'

export const useGroupStore = defineStore('group', () => {
  const groups = ref<HouseGroupWithOwner[]>([])             // 전체 (iot_enabled 무관)
  // iot_enabled=true 만 — groups 에서 파생(computed) → 순서/토글 변경이 즉시 반영됨
  const iotGroups = computed<HouseGroupWithOwner[]>(() =>
    groups.value
      .filter(g => g.iotEnabled !== false)
      .map(g => ({ ...g, houses: (g.houses ?? []).filter(h => h.iotEnabled !== false) })) as HouseGroupWithOwner[],
  )
  const houses = ref<House[]>([])
  const loading = ref(false)

  const allHouses = computed(() => {
    const fromGroups = groups.value.flatMap(g => g.houses || [])
    const standalone = houses.value.filter(h => !fromGroups.find(fh => fh.id === h.id))
    return [...fromGroups, ...standalone]
  })

  const iotHouses = computed(() => allHouses.value.filter(h => h.iotEnabled !== false))
  const hiddenZoneCount = computed(() => groups.value.filter(g => g.iotEnabled === false).length)

  function getHousesByGroup(groupId: string) {
    return allHouses.value.filter(h => h.groupId === groupId)
  }

  async function fetchGroups() {
    loading.value = true
    try {
      const { data } = await groupApi.getGroups()
      groups.value = data
      // iotGroups 는 computed 라 자동 파생됨
    } finally {
      loading.value = false
    }
  }

  async function fetchIotGroups() {
    // 별도 호출이 필요한 경우용 — 기본은 fetchGroups 한 번으로 둘 다 갱신
    await fetchGroups()
  }

  async function bulkUpdateIotEnabled(updates: Array<{ id: string; enabled: boolean }>) {
    await groupApi.bulkUpdateIotEnabled(updates)
    await fetchGroups()
  }

  async function fetchHouses() {
    try {
      const { data } = await groupApi.getHouses()
      houses.value = data
    } catch {
      // silent
    }
  }

  async function createGroup(payload: CreateGroupRequest) {
    const { data } = await groupApi.createGroup(payload)
    await fetchGroups()
    return data
  }

  async function removeGroup(id: string) {
    await groupApi.removeGroup(id)
    groups.value = groups.value.filter(g => g.id !== id)
  }

  async function createHouse(payload: CreateHouseRequest) {
    const { data } = await groupApi.createHouse(payload)
    await fetchGroups()
    await fetchHouses()
    return data
  }

  async function assignDevices(groupId: string, deviceIds: string[]) {
    const { data } = await groupApi.assignDevices(groupId, deviceIds)
    await fetchGroups()
    return data
  }

  async function removeDeviceFromGroup(groupId: string, deviceId: string) {
    await groupApi.removeDeviceFromGroup(groupId, deviceId)
    await fetchGroups()
  }

  return {
    groups,
    iotGroups,
    houses,
    allHouses,
    iotHouses,
    hiddenZoneCount,
    loading,
    getHousesByGroup,
    fetchGroups,
    fetchIotGroups,
    fetchHouses,
    createGroup,
    removeGroup,
    createHouse,
    assignDevices,
    removeDeviceFromGroup,
    bulkUpdateIotEnabled,
  }
})
