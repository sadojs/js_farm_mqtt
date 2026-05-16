# Plan: gateway-env-ux

- **작성일**: 2026-05-09
- **담당자**: katsuhisa91
- **우선순위**: High
- **예상 규모**: Medium (프론트엔드 중심, 백엔드 버그 수정 포함)

---

## 배경 및 목적

현재 게이트웨이 환경 설정(`GatewayEnvSettings`)은 게이트웨이 관리 페이지에서 진입하도록 구현되어 있으나, 두 가지 문제가 있다.

1. **UX 문제**: 어느 하우스(구역)에 속한 게이트웨이인지 컨텍스트 없이 환경 설정이 열린다. 하우스에 할당된 후에 설정하는 것이 논리적으로 자연스럽다.
2. **버그**: 온보드 장치 탭이 오류로 렌더링되지 않으며, Zigbee 스캔이 "장치 없음" 또는 오류를 반환한다.

또한 장치 관리 페이지(`Devices.vue`)에 장치 추가/등록 기능이 있으나, 이는 게이트웨이 환경 설정에서 장치를 활성화함으로써 대체된다.

---

## 요구사항

### FR-01. 구역 관리에서 게이트웨이 환경 설정 진입

- `Groups.vue`(구역 관리)에서 게이트웨이가 할당된 하우스 카드에 "⚙ 환경 설정" 버튼 추가
- 클릭 시 `/gateways/:id/env?houseId=:houseId` 로 이동
- `GatewayEnvSettings.vue`는 `houseId` 쿼리 파라미터를 받아 상단에 "하우스명의 게이트웨이" 표시

### FR-02. 게이트웨이 관리 페이지에서 환경 설정 버튼 변경

- 게이트웨이가 하우스에 할당된 경우: "환경 설정" 버튼을 회색/disabled 처리하고 "구역 관리에서 설정하세요" tooltip 표시
- 게이트웨이가 미할당인 경우: 버튼 제거 또는 "하우스 할당 후 설정 가능" 안내 텍스트 표시

### FR-03. 온보드 장치 탭 버그 수정

- `getOnboard` API 호출 시 오류 원인 파악 및 수정
- 예상 원인: `gateway-env.service.ts`의 `ensureOnboardDevices()` 또는 TypeORM 관련 오류
- 스크린 렌더링 오류(Vue 컴파일 또는 null 참조) 수정

### FR-04. Zigbee 스캔 버그 수정

- `scanZigbee` 호출 시 "스캔된 장치 없음" 문제: `mqtt-bridge.handler.ts`의 `deviceCache`가 비어 있는 경우 처리
- 재스캔 오류: 오류 핸들링 및 사용자 안내 메시지 개선
- MQTT `bridge/devices` 토픽이 수신되지 않은 상태에서 스캔 요청 시 fallback 처리

### FR-05. 장치 관리 페이지 단순화

- `Devices.vue`에서 "장치 추가" 버튼(`showRegistrationModal`) 및 등록 모달 컴포넌트 제거
- 대신 상단에 안내 문구 추가: "장치는 게이트웨이 환경 설정에서 활성화됩니다"
- 기존 장치 목록 표시, 개별 장치 제어 기능은 유지
- 장치 이름 인라인 편집, 채널 매핑 변경 등 기존 관리 기능은 유지

---

## 비기능 요구사항

- 게이트웨이가 아직 하우스에 미할당된 경우에도 게이트웨이 관리 페이지에서 직접 접근 가능한 fallback 경로 유지 (예: admin 전용)
- 버그 수정은 기존 API 계약(엔드포인트, 요청/응답 형식) 변경 없이 해결

---

## 영향 범위

| 영역 | 파일 | 변경 유형 |
|------|------|-----------|
| Frontend | `frontend/src/views/Groups.vue` | 수정 (환경 설정 버튼 추가) |
| Frontend | `frontend/src/views/GatewayManagement.vue` | 수정 (버튼 비활성화/안내) |
| Frontend | `frontend/src/views/GatewayEnvSettings.vue` | 수정 (houseId 표시, 버그 수정) |
| Frontend | `frontend/src/views/Devices.vue` | 수정 (장치 추가 제거, 안내 추가) |
| Backend | `backend/src/modules/gateway-env/gateway-env.service.ts` | 수정 (버그 수정) |
| Backend | `backend/src/modules/mqtt/mqtt-bridge.handler.ts` | 수정 (스캔 fallback) |

---

## 완료 기준

- [ ] 구역 관리 페이지에서 게이트웨이가 할당된 하우스에 "⚙ 환경 설정" 버튼이 표시된다
- [ ] 버튼 클릭 시 해당 하우스명이 환경 설정 상단에 표시된다
- [ ] 게이트웨이 관리 페이지의 "환경 설정" 버튼이 하우스 할당 여부에 따라 적절히 처리된다
- [ ] 온보드 장치 탭이 오류 없이 렌더링된다
- [ ] Zigbee 스캔 결과가 올바르게 표시되거나, 스캔 불가 시 명확한 오류 메시지가 표시된다
- [ ] 장치 관리 페이지에서 장치 추가 버튼이 제거되고, 안내 문구가 표시된다
- [ ] 기존 장치 목록 및 제어 기능은 정상 동작한다
