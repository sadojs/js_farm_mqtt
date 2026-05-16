# Design: web-terminal

## Overview
xterm.js + Socket.io WebSocket 기반 SSH 프록시 시스템.
브라우저 → NestJS WebSocket(/ssh) → ssh2 → Pi SSH 의 흐름.

## Architecture

```
Browser (xterm.js)
  ↕ Socket.io /ssh namespace
NestJS SshProxyGateway
  ↕ ssh2 Client
localhost:{tunnelPort}  (autossh reverse tunnel)
  ↕ SSH
Raspberry Pi sshd
```

## Backend: ssh-proxy Module

### Files
- `backend/src/modules/ssh-proxy/ssh-proxy.module.ts`
- `backend/src/modules/ssh-proxy/ssh-proxy.service.ts`
- `backend/src/modules/ssh-proxy/ssh-proxy.gateway.ts`

### SshProxyService
```typescript
// SSH key: process.env.SSH_TUNNEL_KEY_PATH ?? ~/.ssh/id_rpi_lgw
// SSH user: process.env.SSH_TUNNEL_USER ?? 'lgw-dev'

openShell(tunnelPort, cols, rows, onData, onClose): Promise<{write, resize, destroy}>
exec(tunnelPort, command): Promise<{stdout, stderr, code}>
putFile(tunnelPort, remotePath, content): Promise<void>
getTunnelPort(gatewayId): Promise<number>  // DB lookup via GatewayManagerService
```

### SshProxyGateway (@WebSocketGateway namespace='/ssh')
- `handleConnection`: JWT verify, role check (admin|farm_admin), disconnect on fail
- `handleConnectShell`: SSH shell 열기, sessions Map에 저장
- `handleData`: stdin 전달
- `handleResize`: terminal window resize
- `handleDisconnect`: session 정리

**WebSocket Events:**
| Client → Server | Server → Client |
|-----------------|-----------------|
| `connect_shell { gatewayId, cols, rows }` | `ready` |
| `data: string` | `data: string` |
| `resize { cols, rows }` | `exit` |
| | `error { message }` |

### Authentication
- `client.handshake.auth.token` (JWT)
- role: `admin` 또는 `farm_admin`만 허용
- 인증 실패 시 `client.disconnect()`

## Backend: config-deploy 리팩토링

### Before (MQTT 방식)
- MqttService.publishConfigRequest() → MQTT publish
- Pi config-agent 응답 대기 (pendingRequests Map, 15초 타임아웃)
- handleConfigResponse() → resolve Promise

### After (SSH 방식)
1. `sshService.exec(port, 'cat config.yaml')` → YAML 파싱
2. config 머지 (보호 필드 제외)
3. `sshService.putFile(port, tmpPath, yamlContent)` → SFTP 업로드
4. `sshService.exec(port, 'sudo cp tmp config && restart && is-active')` → 재시작
5. 실패 시 백업(.bak) 복원

**제거된 의존성:**
- MqttService → ConfigDeployService 의존 제거
- ConfigDeployModule → MqttModule 순환 참조 제거
- MQTT topic: `farm/+/config/response` 구독 제거

## Frontend: WebTerminal.vue

### Location
`frontend/src/components/gateway/WebTerminal.vue`

### Props
```typescript
props: {
  gatewayId: string       // required
  gatewayName?: string    // optional, for display
}
emits: { close: void }
```

### Dependencies
- `@xterm/xterm` Terminal
- `@xterm/addon-fit` FitAddon (자동 크기 맞춤)
- `socket.io-client` (기존 설치)

### State Machine
```
idle → connecting → connected → disconnected
                 ↘ error
```

### Connection Flow
1. `io('/ssh', { auth: { token: authStore.accessToken } })`
2. `emit('connect_shell', { gatewayId, cols, rows })`
3. `on('ready')` → 터미널 활성화
4. `on('data')` → `term.write()`
5. `term.onData()` → `emit('data')`
6. ResizeObserver → `fitAddon.fit()` + `emit('resize', { cols, rows })`

### UI Elements
- 상단 툴바: 게이트웨이명, 연결 상태 배지, 재연결 버튼, 닫기 버튼
- 에러 메시지 표시 영역
- xterm.js 터미널 본문 (dark theme, 13px monospace)

## Frontend: GatewayManagement 통합

### Changes
- `WebTerminal` 컴포넌트 import
- `terminalGateway` ref 추가 (열려있는 터미널의 게이트웨이)
- `openTerminal(gw)` 함수
- "⌨ 터미널" 버튼: `tunnelStatus === 'connected' && tunnelPort` 조건부 표시
- 터미널 오버레이: 900×560 modal, 배경 클릭 시 닫기

## Environment Variables (Backend)
```
SSH_TUNNEL_KEY_PATH=~/.ssh/id_rpi_lgw  (default)
SSH_TUNNEL_USER=lgw-dev                 (default)
```

## Security
- JWT 인증 필수 (handshake.auth.token)
- admin/farm_admin 역할만 접근 가능
- SSH key는 서버 파일시스템에서만 읽음 (클라이언트 노출 없음)
- `restrict,port-forwarding` 옵션으로 Pi authorized_keys 제한
