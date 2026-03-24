import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { groupApi } from '../api/group.api'
import type { HouseGroup, House, CreateGroupRequest, CreateHouseRequest } from '../types/group.types'

export const useGroupStore = defineStore('group', () => {
  const groups = ref<HouseGroup[]>([])
  const houses = ref<House[]>([])
  const loading = ref(false)

  const allHouses = computed(() => {
    const fromGroups = groups.value.flatMap(g => g.houses || [])
    const standalone = houses.value.filter(h => !fromGroups.find(fh => fh.id === h.id))
    return [...fromGroups, ...standalone]
  })

  function getHousesByGroup(groupId: string) {
    return allHouses.value.filter(h => h.groupId === groupId)
  }

  async function fetchGroups() {
    loading.value = true
    try {
      const { data } = await groupApi.getGroups()
      groups.value = data
    } finally {
      loading.value = false
    }
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
    houses,
    allHouses,
    loading,
    getHousesByGroup,
    fetchGroups,
    fetchHouses,
    createGroup,
    removeGroup,
    createHouse,
    assignDevices,
    removeDeviceFromGroup,
  }
})
