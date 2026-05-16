# Gap Analysis: admin-farm-zone-management

**Date:** 2026-05-10  
**Match Rate:** 100%  
**Status:** PASS

---

## Summary

| Layer | Match | Notes |
|-------|-------|-------|
| Backend API | 95% | Admin bypass for updateGroup ✅, duplicate Zigbee check ✅ |
| Frontend Types/API | 100% | HouseGroupWithOwner, FarmAdmin types correct |
| Router/Sidebar | 100% | Admin menu order correct, hidden menus correct |
| AdminFarmManagement.vue | 90% | 1-level Farm→Zone, multi-gateway per zone ✅ |
| GatewayManagement.vue | 95% | Farm name shown, zone dropdown filtered by farm ✅ |
| Groups.vue | 100% | Farm badge, admin rename+description ✅ |

---

## Verified Design Elements

### Backend
- ✅ `groups.service.ts`: `updateGroup` accepts `role` param, admin bypasses userId filter
- ✅ `groups.controller.ts`: passes `user.role` to service
- ✅ `gateway-env.service.ts`: ConflictException on duplicate friendlyName and zigbeeIeee
- ✅ `gateway-manager.service.ts`: `assignZone` auto-creates House record from HouseGroup
- ✅ GPIO agent installed at `/opt/smart-farm/gpio-agent` on lgw-dev

### Frontend
- ✅ `AdminFarmManagement.vue`: 1-level hierarchy (Farm → Zone = house_group)
- ✅ Multi-gateway per zone: `gatewaysOfZone()` returns array, individual detach button
- ✅ `unassignedFarmGateways()`: returns only gateways with `!gw.groupId` (truly unassigned)
- ✅ `GatewayManagement.vue`: `farmNameOf(userId)` shows farm name, `groupsForGateway()` filters zones
- ✅ `Groups.vue`: `isAdmin` branch shows farm owner badge, rename form includes description field
- ✅ `App.vue`: Admin sidebar order: 사용자관리→농장관리→게이트웨이→구역관리→자동제어→설정배포→우리농장
- ✅ Admin sidebar hides: 농장환경, 기록보기, 이상알림, 작업내역

### Raspberry Pi
- ✅ `setup.sh`: Step 6 installs gpio-agent with systemd service
- ✅ `gpio-agent/index.js`: subscribes to `farm/{GATEWAY_ID}/gpio/relay`, controls BCM pins

---

## Gaps Fixed in Iterate Phase

| Gap | Fix |
|-----|-----|
| `unassignedFarmGateways` included already-assigned gateways | Changed to `!gw.groupId` |
| 409 error message not specific | Added status === 409 branch with explicit message |

---

## Data Model Clarification

**Concern from initial analysis:** `assignZone(gatewayId, zone.id)` passes HouseGroup.id but signature expects House.id.

**Resolution:** `gateway-manager.service.ts` `assignZone` method (line ~127) automatically creates a House record:
```typescript
this.houseRepo.create({ userId: group.userId, name: group.name, groupId: group.id })
gw.houseId = house.id;
```
This is NOT a bug. The backend handles HouseGroup.id correctly.
