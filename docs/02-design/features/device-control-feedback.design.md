# device-control-feedback Design Document

> **Summary**: 장비 제어 후 성공/실패 피드백 토스트 알림 + 상태 자동 검증 시스템
>
> **Project**: smart-farm-platform
> **Date**: 2026-03-04
> **Status**: Draft
> **Planning Doc**: [device-control-feedback.plan.md](../../01-plan/features/device-control-feedback.plan.md)

---

## 1. Overview

### 1.1 Design Goals

1. 장비 제어 후 Tuya API 응답을 활용한 즉각적 성공/실패 피드백 제공
2. 제어 성공 시 1초 후 상태 재확인으로 물리적 적용 검증
3. `alert()` 대신 토스트 알림 UI로 비침습적 사용자 경험 제공
4. Tuya 에러 코드를 한국어로 번역하여 이해 가능한 에러 메시지 표시

### 1.2 Design Principles

- **최소 변경**: 기존 notification.store.ts 재사용, 새 UI 컴포넌트 1개만 추가
- **비침습적 UX**: 토스트는 화면 하단에 표시, 작업 흐름 방해 없음
- **단계적 확인**: 실패는 즉시 감지, 성공은 비동기 검증 (API 2회는 성공 시에만)

---

## 2. Architecture

### 2.1 제어 피드백 플로우

```
토글 클릭
    ↓
① POST /devices/:id/control
    ↓
② Tuya API 응답 확인 (result.data.success)
    ↓
┌─── success: false ───────────────────────────┐
│  즉시 에러 토스트 표시                         │
│  "제어 실패: 장비가 오프라인입니다"             │
│  UI를 원래 상태로 되돌림                       │
└──────────────────────────────────────────────┘
┌─── success: true ────────────────────────────┐
│  낙관적 UI 유지                               │
│  1초 대기                                     │
│  GET /devices/:id/status 호출                 │
│  실제 상태(switchCode) 확인                    │
└──────────────────────────────────────────────┘
    ↓
┌─── 실제 상태 === 요청 상태 ──────────────────┐
│  성공 토스트: "적용 완료"                      │
└──────────────────────────────────────────────┘
┌─── 실제 상태 !== 요청 상태 ──────────────────┐
│  경고 토스트: "명령 전달됨, 상태 미변경"       │
│  UI를 실제 상태로 업데이트                     │
└──────────────────────────────────────────────┘
```

### 2.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  App.vue                                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ <ToastContainer />  ← 신규 컴포넌트                      ││
│  │  notification.store의 notifications 렌더링               ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ <router-view />                                          ││
│  │  ┌─────────────┐  ┌─────────────┐                       ││
│  │  │ Devices.vue │  │ Groups.vue  │                        ││
│  │  │ handleControl│  │ handleControl│                       ││
│  │  │ handleIrrig.│  │ handleIrrig.│                        ││
│  │  │ interlockCtl│  │             │                        ││
│  │  └──────┬──────┘  └──────┬──────┘                       ││
│  │         └────────┬───────┘                               ││
│  │                  ↓                                       ││
│  │  ┌──────────────────────────┐                            ││
│  │  │ device.store.ts          │                            ││
│  │  │ controlDevice() → data   │                            ││
│  │  │ verifyDeviceStatus()     │  ← 신규 함수               ││
│  │  │ fetchDeviceStatus()      │  ← 기존 (검증에 재사용)     ││
│  │  └──────────────────────────┘                            ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ notification.store.ts  ← 기존 (변경 없음)                ││
│  │ success() / error() / warning() / info()                 ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ utils/tuya-errors.ts  ← 신규                             ││
│  │ translateTuyaError(msg) → 한국어 메시지                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| ToastContainer.vue | notification.store.ts | 토스트 알림 렌더링 |
| Devices.vue / Groups.vue | device.store.ts, notification.store.ts | 제어 + 피드백 표시 |
| device.store.ts | device.api.ts, tuya-errors.ts | 제어 명령 + 상태 검증 |

---

## 3. 상세 설계

### 3.1 ToastContainer.vue (신규)

notification.store.ts에 이미 `notifications` 배열, `add()`, `remove()`, `success()`/`error()`/`warning()`/`info()` 메서드가 존재하지만, 이를 화면에 렌더링하는 UI 컴포넌트가 없음. App.vue에 `<ToastContainer />`를 추가.

**위치**: `frontend/src/components/common/ToastContainer.vue`

```vue
<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container">
      <div
        v-for="n in notifications"
        :key="n.id"
        :class="['toast', `toast-${n.type}`]"
        role="alert"
      >
        <span class="toast-icon">{{ ICON_MAP[n.type] }}</span>
        <div class="toast-body">
          <strong class="toast-title">{{ n.title }}</strong>
          <p v-if="n.message" class="toast-message">{{ n.message }}</p>
        </div>
        <button class="toast-close" @click="remove(n.id)" aria-label="닫기">&times;</button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>
```

**스타일 스펙**:

```
위치: 화면 하단 중앙 (모바일 하단, 데스크탑 하단-우측)
최대 너비: 400px (모바일: 100% - 32px)
z-index: 9999
애니메이션: 아래에서 위로 슬라이드 + fade

타입별 색상 (CSS 변수 활용):
  success: 좌측 4px 초록 보더 (#4caf50)
  error:   좌측 4px 빨강 보더 (#e53935), 수동 닫기 필요
  warning: 좌측 4px 노랑 보더 (#ff9800)
  info:    좌측 4px 파랑 보더 (#2196f3)

아이콘 맵:
  success: ✓
  error:   ✕
  warning: !
  info:    i
```

**기존 notification.store.ts의 타임아웃 설정 그대로 사용**:
- success: 5초 자동 닫힘
- error: 8초 자동 닫힘
- warning: 6초 자동 닫힘
- info: 5초 자동 닫힘

### 3.2 controlDevice 반환값 변경 (device.store.ts)

**AS-IS**:
```typescript
// device.store.ts:39-41
async function controlDevice(deviceId: string, commands: { code: string; value: any }[]) {
  return deviceApi.control(deviceId, commands)  // AxiosResponse 반환
}
```

**TO-BE**:
```typescript
async function controlDevice(deviceId: string, commands: { code: string; value: any }[]) {
  const { data } = await deviceApi.control(deviceId, commands)
  return data  // Tuya 응답 데이터 직접 반환: { success, result, msg, code, t, tid }
}
```

**변경 이유**: 호출부에서 `result.data.success` 대신 `result.success`로 간결하게 접근.

### 3.3 verifyDeviceStatus 함수 (device.store.ts 신규)

```typescript
async function verifyDeviceStatus(
  deviceId: string,
  switchCode: string,
  expectedValue: boolean
): Promise<{ verified: boolean; actualValue?: boolean }> {
  await new Promise(resolve => setTimeout(resolve, 1000))

  const data = await fetchDeviceStatus(deviceId)
  if (!data || !data.success) {
    return { verified: false }  // 확인 실패 — 제어 자체는 성공이므로 UI 유지
  }

  const status = data.status?.find((s: any) => s.code === switchCode)
  if (!status) return { verified: false }

  return {
    verified: status.value === expectedValue,
    actualValue: status.value,
  }
}
```

**반환값 의미**:
- `{ verified: true }`: 실제 장비 상태가 기대값과 일치 → 성공 토스트
- `{ verified: false, actualValue: ... }`: 불일치 → 경고 토스트 + UI 업데이트
- `{ verified: false }` (actualValue 없음): 상태 확인 자체 실패 → 경고 토스트, UI 유지

### 3.4 Tuya 에러 번역 (tuya-errors.ts 신규)

**위치**: `frontend/src/utils/tuya-errors.ts`

```typescript
const TUYA_ERROR_MAP: Record<string, string> = {
  'device is offline': '장비가 오프라인입니다',
  'permission deny': '권한이 없습니다',
  'token invalid': '인증이 만료되었습니다. 새로고침해 주세요',
  'param is wrong': '잘못된 명령입니다',
  'timeout': '응답 시간 초과',
}

export function translateTuyaError(msg?: string): string {
  if (!msg) return '알 수 없는 오류'
  return TUYA_ERROR_MAP[msg] || msg
}
```

---

## 4. 핸들러별 수정 설계

### 4.1 Devices.vue — handleControl (L428-440)

**AS-IS**:
```typescript
const handleControl = async (deviceId: string, turnOn: boolean) => {
  controllingId.value = deviceId
  try {
    await deviceStore.controlDevice(deviceId, [{ code: 'switch_1', value: turnOn }])
    const device = deviceStore.devices.find(d => d.id === deviceId)
    if (device) device.switchState = turnOn
  } catch (err: any) {
    console.error('장비 제어 실패:', err)
    alert('장비 제어에 실패했습니다.')
  } finally {
    controllingId.value = null
  }
}
```

**TO-BE**:
```typescript
const handleControl = async (deviceId: string, turnOn: boolean) => {
  controllingId.value = deviceId
  const device = deviceStore.devices.find(d => d.id === deviceId)
  try {
    const result = await deviceStore.controlDevice(deviceId, [{ code: 'switch_1', value: turnOn }])
    if (!result.success) {
      notify.error('제어 실패', translateTuyaError(result.msg))
      return
    }
    // 낙관적 업데이트
    if (device) device.switchState = turnOn
    // 비동기 상태 검증
    const verification = await deviceStore.verifyDeviceStatus(deviceId, 'switch_1', turnOn)
    if (verification.verified) {
      notify.success('적용 완료', `${device?.name || '장비'} ${turnOn ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined && device) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
      device.switchState = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장비 상태를 확인할 수 없습니다')
    }
  } catch (err: any) {
    console.error('장비 제어 실패:', err)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
    if (device) device.switchState = !turnOn
  } finally {
    controllingId.value = null
  }
}
```

### 4.2 Devices.vue — handleIrrigationControl (L323-336)

**TO-BE**:
```typescript
async function handleIrrigationControl(device: Device, switchCode: string) {
  irrigationControlling.value = device.id
  try {
    const currentVal = device.switchStates?.[switchCode] ?? false
    const newVal = !currentVal
    const result = await deviceStore.controlDevice(device.id, [{ code: switchCode, value: newVal }])
    if (!result.success) {
      notify.error('제어 실패', translateTuyaError(result.msg))
      return
    }
    // 낙관적 업데이트
    if (!device.switchStates) device.switchStates = {}
    device.switchStates[switchCode] = newVal
    // 비동기 상태 검증
    const verification = await deviceStore.verifyDeviceStatus(device.id, switchCode, newVal)
    if (verification.verified) {
      const label = IRRIGATION_SWITCH_LABELS[switchCode] || switchCode
      notify.success('적용 완료', `${label} ${newVal ? 'ON' : 'OFF'}`)
    } else if (verification.actualValue !== undefined) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
      device.switchStates[switchCode] = verification.actualValue
    } else {
      notify.warning('상태 확인 실패', '장비 상태를 확인할 수 없습니다')
    }
  } catch (err: any) {
    console.error('관수 장비 제어 실패:', err)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    irrigationControlling.value = null
  }
}
```

### 4.3 Devices.vue — interlockControl (L269-294)

개폐기 인터록은 최대 3번의 `controlDevice` 호출이 발생 (반대 OFF → 대기 → 타겟 ON).
Plan 문서의 예외 사항에 따라 **최종 결과만 피드백**.

**TO-BE**:
```typescript
async function interlockControl(group: OpenerGroup, action: 'open' | 'close') {
  const targetDevice = action === 'open' ? group.openDevice : group.closeDevice
  const oppositeDevice = action === 'open' ? group.closeDevice : group.openDevice

  interlocking.value = true
  try {
    // 이미 ON이면 OFF만
    if (targetDevice.switchState) {
      const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: false }])
      if (!result.success) {
        notify.error('제어 실패', translateTuyaError(result.msg))
        return
      }
      targetDevice.switchState = false
      const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', false)
      if (v.verified) {
        notify.success('적용 완료', `${targetDevice.name} OFF`)
      } else if (v.actualValue !== undefined) {
        notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
        targetDevice.switchState = v.actualValue
      }
      return
    }
    // 반대쪽이 ON이면: 먼저 OFF → 1.5초 대기
    if (oppositeDevice.switchState) {
      const offResult = await deviceStore.controlDevice(oppositeDevice.id, [{ code: 'switch_1', value: false }])
      if (!offResult.success) {
        notify.error('제어 실패', translateTuyaError(offResult.msg))
        return
      }
      oppositeDevice.switchState = false
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    // 타겟 ON
    const result = await deviceStore.controlDevice(targetDevice.id, [{ code: 'switch_1', value: true }])
    if (!result.success) {
      notify.error('제어 실패', translateTuyaError(result.msg))
      return
    }
    targetDevice.switchState = true
    // 최종 상태 검증
    const v = await deviceStore.verifyDeviceStatus(targetDevice.id, 'switch_1', true)
    if (v.verified) {
      notify.success('적용 완료', `${targetDevice.name} ${action === 'open' ? '열림' : '닫힘'}`)
    } else if (v.actualValue !== undefined) {
      notify.warning('상태 미변경', '명령은 전달되었으나 장비 상태가 변경되지 않았습니다')
      targetDevice.switchState = v.actualValue
    }
  } catch (err) {
    console.error('인터록 제어 실패:', err)
    notify.error('제어 실패', '네트워크 오류가 발생했습니다')
  } finally {
    interlocking.value = false
  }
}
```

### 4.4 Groups.vue — handleControl (L676-688)

Devices.vue의 handleControl과 동일한 패턴 적용.

### 4.5 Groups.vue — handleIrrigationControl (L627-643)

Devices.vue의 handleIrrigationControl과 동일한 패턴 적용.
Groups.vue의 경우 `storeDevice`를 별도로 찾아 업데이트하는 기존 패턴 유지.

---

## 5. UI/UX Design

### 5.1 토스트 알림 레이아웃

```
[모바일 — 하단 중앙, safe-area-inset-bottom 적용]

┌──────────────────────────────────────────┐
│ ┊ ✓ 적용 완료                    ✕     │
│ ┊   석문리 연동 센서 ON                 │
└──────────────────────────────────────────┘
  ↑ 좌측 4px 초록 보더

┌──────────────────────────────────────────┐
│ ┊ ! 상태 미변경                  ✕     │
│ ┊   명령은 전달되었으나 장비 상태가     │
│ ┊   변경되지 않았습니다                 │
└──────────────────────────────────────────┘
  ↑ 좌측 4px 노랑 보더

┌──────────────────────────────────────────┐
│ ┊ ✕ 제어 실패                    ✕     │
│ ┊   장비가 오프라인입니다               │
└──────────────────────────────────────────┘
  ↑ 좌측 4px 빨강 보더
```

### 5.2 토스트 스택

여러 토스트가 동시에 표시될 수 있음 (예: 인터록 제어에서 반대 OFF + 타겟 ON).
최대 3개까지 스택, 초과 시 가장 오래된 것 자동 제거.

---

## 6. Error Handling

### 6.1 에러 시나리오별 처리

| 시나리오 | 감지 지점 | 사용자 피드백 | UI 처리 |
|----------|-----------|---------------|---------|
| Tuya API 실패 (장비 오프라인) | controlDevice result.success === false | 에러 토스트 + 한국어 에러 메시지 | UI 원상 복구 |
| 네트워크 에러 (서버 unreachable) | try/catch 에러 | 에러 토스트 "네트워크 오류가 발생했습니다" | UI 원상 복구 |
| 명령 성공 + 물리적 미동작 | verifyDeviceStatus 불일치 | 경고 토스트 "상태 미변경" | UI를 실제 상태로 |
| 상태 확인 API 실패 | verifyDeviceStatus null 반환 | 경고 토스트 "상태 확인 실패" | UI 유지 (제어 자체는 성공) |

---

## 7. 수정 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `frontend/src/components/common/ToastContainer.vue` | **신규** | 토스트 알림 UI 렌더링 컴포넌트 |
| `frontend/src/utils/tuya-errors.ts` | **신규** | Tuya 에러 코드 한국어 번역 함수 |
| `frontend/src/stores/device.store.ts` | 수정 | `controlDevice` 반환값 `.data` + `verifyDeviceStatus` 추가 |
| `frontend/src/views/Devices.vue` | 수정 | `handleControl`, `handleIrrigationControl`, `interlockControl` 응답 처리 |
| `frontend/src/views/Groups.vue` | 수정 | `handleControl`, `handleIrrigationControl` 응답 처리 |
| `frontend/src/App.vue` | 수정 | `<ToastContainer />` import + 렌더링 추가 |
| `frontend/src/stores/notification.store.ts` | 변경 없음 | 기존 API 그대로 사용 |

---

## 8. Implementation Order

| Step | 내용 | 파일 | 의존성 |
|------|------|------|--------|
| 1 | ToastContainer.vue 생성 | components/common/ToastContainer.vue | notification.store.ts |
| 2 | App.vue에 ToastContainer 등록 | App.vue | Step 1 |
| 3 | tuya-errors.ts 생성 | utils/tuya-errors.ts | 없음 |
| 4 | controlDevice 반환값 변경 + verifyDeviceStatus 추가 | device.store.ts | 없음 |
| 5 | Devices.vue 3개 핸들러 수정 | Devices.vue | Step 3, 4 |
| 6 | Groups.vue 2개 핸들러 수정 | Groups.vue | Step 3, 4 |
| 7 | 빌드 검증 (vue-tsc + vite build) | - | Step 1~6 |

---

## 9. Verification Checklist

- [ ] 제어 성공 시: 1초 후 상태 확인 → 성공 토스트 표시
- [ ] Tuya API 실패 시: 즉시 에러 토스트 (한국어) + UI 원래 상태 복구
- [ ] 명령 성공 + 상태 미변경: 경고 토스트 + UI를 실제 상태로 업데이트
- [ ] 관수 장비: 특정 switchCode별 상태 확인
- [ ] 개폐기 인터록: 최종 결과만 피드백 (중간 단계 생략)
- [ ] 토스트가 화면에 정상 렌더링 (App.vue에 ToastContainer 포함)
- [ ] 다크 모드에서 토스트 정상 표시
- [ ] 모바일에서 safe-area-inset-bottom 적용
- [ ] vue-tsc + vite build 에러 없음

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-03-04 | Initial draft |
