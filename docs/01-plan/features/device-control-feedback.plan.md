# Plan: 장비 제어 피드백 (device-control-feedback)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | device-control-feedback |
| Phase | Plan |
| 작성일 | 2026-03-04 |
| 우선순위 | High (UX — 제어 결과 확인 불가) |

---

## 현재 문제

### 문제 1 — 제어 성공/실패 피드백 없음

```
현재 흐름:
  토글 클릭 → 낙관적 UI 업데이트 → POST /devices/:id/control
                                          ↓
                                   Tuya API 응답
                                   { success: true/false }
                                          ↓
                                   프론트: 응답 무시
                                   (success든 fail이든 UI는 이미 변경됨)
```

- 사용자가 토글을 누르면 UI는 바로 바뀌지만 실제 적용 여부를 알 수 없음
- 성공해도 피드백 없음, 실패해도 `alert('장비 제어에 실패했습니다.')` 만 표시
- "센서 동기화" 버튼을 수동 클릭해야만 실제 상태 확인 가능

### 문제 2 — 낙관적 업데이트 후 불일치 가능

```
시나리오:
  1. 사용자가 토글 ON → UI: ON (낙관적)
  2. Tuya API: success: true (명령 전달 성공)
  3. 하지만 실제 장비가 물리적으로 동작 안 함 (고장, 전원 문제 등)
  4. UI는 ON이지만 실제 장비는 OFF → 사용자 혼동
```

### 문제 3 — 에러 상세 정보 미표시

- Tuya API 에러 코드/메시지를 사용자에게 전달하지 않음
- 네트워크 에러 vs Tuya 오류 vs 장비 오프라인 구분 불가

---

## 현재 코드 분석

### Backend — controlDevice() 응답

```typescript
// devices.service.ts:108-124
async controlDevice(id, userId, commands) {
  // ... DB 조회, 인증 정보 ...
  const result = await this.tuyaService.sendDeviceCommand(credentials, device.tuyaDeviceId, commands)
  return result  // ← Tuya API 응답 그대로 반환
}
```

Tuya API 응답 형식:
```json
// 성공
{ "success": true, "result": true, "t": 1709550000000, "tid": "..." }

// 실패 (장비 오프라인 등)
{ "success": false, "code": 2009, "msg": "device is offline", "t": 1709550000000 }
```

### Frontend — handleControl() 응답 처리

```typescript
// Devices.vue:428-440
const handleControl = async (deviceId, turnOn) => {
  try {
    await deviceStore.controlDevice(deviceId, [...])  // ← 응답 버림
    device.switchState = turnOn  // ← 무조건 낙관적 업데이트
  } catch (err) {
    alert('장비 제어에 실패했습니다.')  // ← 상세 정보 없음
  }
}
```

### Backend — getDeviceStatus() (상태 확인 API)

```typescript
// devices.service.ts:126-157
async getDeviceStatus(id, userId) {
  // ... Tuya API로 실시간 상태 조회 ...
  return {
    success: true,
    deviceId: device.id,
    status: result.result || [],  // [{ code: 'switch_1', value: true/false }]
  }
}
```

---

## 추천 구현 방식: 2단계 확인 (Command + Verify)

```
토글 클릭
    ↓
① POST /devices/:id/control 호출
    ↓
② Tuya API 응답 확인
    ↓
┌──────────────────────────────────────┐
│ success: false                        │
│ → 즉시 에러 토스트 표시               │
│   "제어 실패: 장비가 오프라인입니다"  │
│ → UI를 원래 상태로 되돌림             │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ success: true                         │
│ → 1초 대기                           │
│ → GET /devices/:id/status 호출       │
│ → 실제 상태(switch_1) 확인            │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ 실제 상태 === 요청 상태              │
│ → 성공 토스트: "✓ 적용 완료"         │
│ → UI 유지                           │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ 실제 상태 !== 요청 상태              │
│ → 경고 토스트:                       │
│   "명령은 전달되었으나 장비 상태가    │
│   변경되지 않았습니다"                │
│ → UI를 실제 상태로 업데이트          │
└──────────────────────────────────────┘
```

### 이 방식을 추천하는 이유

| 방식 | 장점 | 단점 |
|------|------|------|
| ① 응답만 확인 | 빠름, API 1회 | Tuya가 success: true여도 물리적 장비 미동작 감지 불가 |
| ② 딜레이 후 상태 확인만 | 가장 확실 | 매번 1초 지연, API 2회 호출 |
| **③ 응답 + 딜레이 확인 (추천)** | **실패는 즉시 감지 + 성공은 물리적 확인** | **API 2회 (성공 시만)** |

방식 ③을 추천합니다:
- 실패: Tuya API 응답으로 **즉시** 감지 (지연 없음)
- 성공: 1초 후 상태 재확인으로 **물리적 적용 확인** (확실)
- 낙관적 업데이트 + 비동기 확인으로 **UX 흐름 끊김 없음**

---

## 기능 요구사항

### FR-01: 제어 명령 응답 처리 (Devices.vue, Groups.vue)

**AS-IS:**
```typescript
await deviceStore.controlDevice(deviceId, commands)
device.switchState = turnOn  // 응답 무시, 무조건 업데이트
```

**TO-BE:**
```typescript
const result = await deviceStore.controlDevice(deviceId, commands)
if (!result.success) {
  // Tuya 실패 → 에러 토스트 + UI 되돌림
  showToast('error', `제어 실패: ${translateTuyaError(result.msg)}`)
  device.switchState = !turnOn  // 원래 상태로 되돌림
  return
}
// Tuya 성공 → 1초 후 상태 확인
device.switchState = turnOn  // 낙관적 유지
await verifyDeviceStatus(deviceId, 'switch_1', turnOn)
```

**적용 대상:**
- `Devices.vue` — `handleControl()`, `handleIrrigationControl()`, `interlockControl()`
- `Groups.vue` — `handleControl()`, `handleIrrigationControl()`, 개폐기 인터록

### FR-02: 상태 확인 함수 (verifyDeviceStatus)

```
verifyDeviceStatus(deviceId, switchCode, expectedValue)
  ↓
  1초 대기
  ↓
  GET /devices/:id/status 호출
  ↓
  실제 상태 비교
  ↓
  일치: 성공 토스트 "✓ [장비명] 적용 완료"
  불일치: 경고 토스트 "⚠ 명령 전달됨, 상태 미변경" + UI를 실제 상태로 업데이트
  에러: 경고 토스트 "상태 확인 실패" (제어 자체는 성공이므로 UI 유지)
```

위치: `device.store.ts` 또는 공유 composable

### FR-03: 토스트 알림 컴포넌트

현재 `alert()`/`console.error()` → 토스트 알림 시스템으로 교체

```
┌──────────────────────────────────────────┐
│ ✓ 석문리 연동 센서  적용 완료            │  ← 성공 (초록, 2초 후 자동 닫힘)
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ ⚠ 명령 전달됨, 장비 상태 미변경          │  ← 경고 (노랑, 4초)
│   장비 물리적 상태를 확인해 주세요        │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ ✕ 제어 실패: 장비가 오프라인입니다        │  ← 에러 (빨강, 수동 닫기)
└──────────────────────────────────────────┘
```

**참고:** 프로젝트에 이미 `notification.store.ts`가 존재하는지 확인 필요.
기존에 토스트/알림 시스템이 있으면 재사용, 없으면 신규 생성.

### FR-04: Tuya 에러 코드 한국어 번역

```typescript
function translateTuyaError(msg: string): string {
  const ERROR_MAP: Record<string, string> = {
    'device is offline': '장비가 오프라인입니다',
    'permission deny': '권한이 없습니다',
    'token invalid': '인증이 만료되었습니다. 새로고침해 주세요',
    'param is wrong': '잘못된 명령입니다',
    'timeout': '응답 시간 초과',
  }
  return ERROR_MAP[msg] || msg || '알 수 없는 오류'
}
```

### FR-05: 관수 장비 다중 스위치 상태 확인

관수 장비는 `switch_1` ~ `switch_6`, `switch_usb1`, `switch_usb2` 등
여러 스위치가 있으므로 특정 `switchCode`에 대한 상태 확인 필요.

```
handleIrrigationControl(device, 'switch_usb1')
  ↓
  controlDevice → result.success?
  ↓
  verifyDeviceStatus(device.id, 'switch_usb1', expectedValue)
  ↓
  status 응답에서 해당 switchCode만 확인
```

### FR-06: controlDevice 반환값 변경

현재 `deviceStore.controlDevice()`는 `deviceApi.control()` 호출 후
`AxiosResponse`를 반환.

Tuya 응답의 `success` 필드를 명확히 활용하려면
반환값 구조를 정리하거나 `.data`를 반환하도록 수정.

---

## 수정 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `frontend/src/stores/device.store.ts` | 수정 | `controlDevice` 반환값 정리 + `verifyDeviceStatus` 추가 |
| `frontend/src/views/Devices.vue` | 수정 | `handleControl`, `handleIrrigationControl`, `interlockControl` 응답 처리 |
| `frontend/src/views/Groups.vue` | 수정 | `handleControl`, `handleIrrigationControl` 응답 처리 |
| `frontend/src/stores/notification.store.ts` | 수정/확인 | 토스트 알림 기능 확인 (있으면 재사용) |
| `frontend/src/utils/tuya-errors.ts` | 신규 (optional) | Tuya 에러 번역 함수 |

---

## 구현 순서

| Phase | 내용 | 파일 |
|-------|------|------|
| 1 | 토스트 알림 시스템 확인/준비 | notification.store.ts |
| 2 | `controlDevice` 반환값 정리 + `verifyDeviceStatus` 추가 | device.store.ts |
| 3 | Tuya 에러 번역 함수 | tuya-errors.ts 또는 인라인 |
| 4 | Devices.vue 3개 핸들러 응답 처리 적용 | Devices.vue |
| 5 | Groups.vue 2개 핸들러 응답 처리 적용 | Groups.vue |
| 6 | 빌드 검증 (vue-tsc + vite build) | - |

---

## 성공 기준

1. 제어 성공 시: 1초 후 상태 확인 → 성공 토스트 "✓ [장비명] 적용 완료"
2. Tuya API 실패 시: 즉시 에러 토스트 (한국어 메시지) + UI 원래 상태로 되돌림
3. 명령 성공 but 상태 미변경: 경고 토스트 + UI를 실제 상태로 업데이트
4. 관수 장비 다중 스위치: 특정 스위치 코드별 상태 확인
5. 개폐기 인터록 제어: 각 단계별 피드백
6. "센서 동기화" 버튼 수동 클릭 불필요 (자동 확인)
7. vue-tsc + vite build 에러 없음

---

## 예외 사항

- 상태 확인(verify) 실패 시에도 제어 명령 자체는 성공이므로 UI를 되돌리지 않음
  (네트워크 일시 오류일 수 있으므로)
- 개폐기 인터록의 경우 중간 단계(반대 OFF → 대기 → 타겟 ON)마다
  피드백을 표시하면 과도할 수 있으므로, 최종 결과만 피드백
- 오프라인 장비는 토글 자체가 비활성화되어 있으므로 오프라인 에러는 드문 케이스
