# Gap Analysis: web-terminal

- **Date:** 2026-05-03
- **Match Rate:** 99%
- **Status:** PASS

## Score Summary

| Category | Score |
|----------|:-----:|
| SshProxyService Methods | 100% |
| SshProxyGateway WebSocket | 100% |
| WebSocket Event Protocol | 100% |
| SSH Environment Variables | 100% |
| config-deploy SSH Refactor | 100% |
| mqtt.service.ts Cleanup | 100% |
| WebTerminal.vue | 95% |
| GatewayManagement.vue Integration | 100% |
| AppModule Registration | 100% |
| **Overall** | **99%** |

## Gaps Found (1 minor)

### [MINOR] WebTerminal.vue 터미널 패널 사이즈
- **Design:** "900×560 고정 modal"
- **Implementation:** `max-width: 900px; height: 560px` (responsive)
- **Impact:** 없음. 반응형으로 더 개선된 구현. 결함 아님.

## All Verified Items

### SshProxyService
- `openShell()`, `exec()`, `putFile()`, `getTunnelPort()` — 시그니처 완전 일치
- `SSH_TUNNEL_KEY_PATH` / `SSH_TUNNEL_USER` 환경변수 default 값 일치

### SshProxyGateway
- namespace `/ssh` ✅
- `handleConnection`: JWT verify + role check (admin|farm_admin) ✅
- `connect_shell` / `data` / `resize` 이벤트 핸들러 ✅
- `handleDisconnect`: session 정리 ✅

### WebSocket Events
- Client→Server: `connect_shell`, `data`, `resize` ✅
- Server→Client: `ready`, `data`, `exit`, `error` ✅

### config-deploy Refactor
- MQTT 의존성 완전 제거 ✅
- SSH exec `cat config.yaml` → YAML 파싱 ✅
- SFTP 업로드 + restart + 실패시 백업 복원 ✅

### mqtt.service.ts Cleanup
- `farm/+/config/response` 구독 제거 ✅
- `publishConfigRequest` 메서드 제거 ✅
- `ConfigDeployService` 주입 제거 ✅

### WebTerminal.vue
- `@xterm/xterm` + `@xterm/addon-fit` ✅
- `gatewayId` / `gatewayName` props, `close` emit ✅
- 상태 머신: idle/connecting/connected/disconnected/error ✅
- ResizeObserver + resize emit ✅

### GatewayManagement.vue
- `WebTerminal` import ✅
- `tunnelStatus === 'connected' && tunnelPort` 조건부 버튼 ✅
- 오버레이 패널, 배경 클릭 닫기 ✅

## Recommendation
즉각적인 수정 불필요. `/pdca report web-terminal`로 완료 보고서 생성 가능.
