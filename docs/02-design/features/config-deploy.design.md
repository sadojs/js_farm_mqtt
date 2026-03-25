# Design: 라즈베리파이 설정 원격 배포 (MQTT 기반)

> Plan 참조: `docs/01-plan/features/config-deploy.plan.md`

## 1. 아키텍처 개요

```
┌──────────────── 맥미니 (서버) ────────────────┐
│                                                │
│  Frontend (Vue 3)          Backend (NestJS)    │
│  ┌──────────────┐   REST   ┌───────────────┐  │
│  │ ConfigDeploy │ ◀──────▶ │ ConfigDeploy  │  │
│  │ Page         │          │ Controller    │  │
│  │ - YAML 편집  │          │ + Service     │  │
│  │ - GW 선택    │          │               │  │
│  │ - Diff 뷰    │          │ MQTT publish  │  │
│  │ - 결과 표시  │          │ ───────────▶  │  │
│  └──────────────┘          └───────┬───────┘  │
│                                    │           │
│  Mosquitto (MQTT Broker) ◀─────────┘           │
│       │                                        │
└───────┼────────────────────────────────────────┘
        │ MQTT (이미 연결됨)
        │
┌───────┼──── 라즈베리파이 (NAT 뒤) ────────────┐
│       ▼                                        │
│  ┌─────────────┐    ┌──────────────────────┐  │
│  │ Config Agent │    │ Zigbee2MQTT          │  │
│  │ (Node.js)   │───▶│ configuration.yaml   │  │
│  │             │    │ systemctl restart    │  │
│  └─────────────┘    └──────────────────────┘  │
│                                                │
└────────────────────────────────────────────────┘
```

## 2. MQTT 토픽 설계

기존 토픽 패턴 `farm/{gatewayId}/z2m/...`에 맞춰 config 네임스페이스 추가:

| 방향 | 토픽 | 페이로드 | QoS |
|------|------|----------|-----|
| 서버→파이 | `farm/{gw}/config/request` | ConfigRequest | 1 |
| 파이→서버 | `farm/{gw}/config/response` | ConfigResponse | 1 |

### ConfigRequest 페이로드

```typescript
interface ConfigRequest {
  /** 요청 고유 ID (응답 매칭용) */
  requestId: string;

  /** 요청 타입 */
  action: 'get_config' | 'update_config';

  /** update_config일 때만 포함 - 공통 설정 (보호 필드 제외) */
  config?: {
    homeassistant?: boolean;
    frontend?: { port?: number; host?: string };
    advanced?: {
      log_level?: string;
      channel?: number;
      last_seen?: string;
      legacy_api?: boolean;
      legacy_availability_payload?: boolean;
      log_output?: string[];
    };
    availability?: {
      active?: { timeout: number };
      passive?: { timeout: number };
    };
    ota?: {
      disable_automatic_update_check?: boolean;
    };
  };

  /** 요청 시각 */
  timestamp: string;
}
```

### ConfigResponse 페이로드

```typescript
interface ConfigResponse {
  /** 요청 ID 에코백 */
  requestId: string;

  /** 응답 타입 */
  action: 'get_config' | 'update_config';

  /** 성공 여부 */
  success: boolean;

  /** 에러 메시지 (실패 시) */
  error?: string;

  /** 현재 설정 전체 (get_config 응답, update_config 후 결과) */
  currentConfig?: Record<string, any>;

  /** 변경된 필드 목록 (update_config 성공 시) */
  changedFields?: string[];

  /** Z2M 서비스 재시작 결과 */
  serviceRestarted?: boolean;

  /** 응답 시각 */
  timestamp: string;

  /** 에이전트 버전 */
  agentVersion: string;
}
```

## 3. Config Agent 설계 (라즈베리파이)

### 3.1 파일 구조

```
raspberry-pi/
├── setup.sh                      # 기존 (Config Agent 설치 단계 추가)
├── config-agent/
│   ├── index.js                  # 메인 - MQTT 구독 + 메시지 라우팅
│   ├── config-manager.js         # 설정 읽기/머지/쓰기/백업
│   ├── protected-fields.js       # 보호 필드 정의
│   └── package.json              # mqtt, js-yaml 의존성
└── systemd/
    ├── zigbee2mqtt.service       # 기존
    └── config-agent.service      # 신규
```

### 3.2 config-agent/index.js - 메인 로직

```javascript
// 핵심 동작:
// 1. MQTT Broker(맥미니)에 연결
// 2. farm/{GATEWAY_ID}/config/request 구독
// 3. 메시지 수신 → action에 따라 처리
// 4. farm/{GATEWAY_ID}/config/response로 결과 publish

const CONFIG = {
  GATEWAY_ID: process.env.GATEWAY_ID,        // setup.sh에서 설정
  MQTT_SERVER: process.env.MQTT_SERVER,      // setup.sh에서 설정
  Z2M_CONFIG_PATH: '/opt/zigbee2mqtt/data/configuration.yaml',
  AGENT_VERSION: '1.0.0',
};
```

### 3.3 config-manager.js - 설정 머지 핵심 로직

```javascript
const PROTECTED_FIELDS = [
  'mqtt.base_topic',
  'mqtt.server',
  'advanced.network_key',
  'advanced.pan_id',
  'serial.port',
  'serial.adapter',
  'devices',
  'groups',
];

/**
 * 안전한 설정 머지
 * 1. 현재 설정 읽기 (YAML → Object)
 * 2. 백업 생성 (.bak)
 * 3. 요청 설정에서 보호 필드 제거 (이중 안전)
 * 4. 현재 설정에 공통 설정만 머지
 * 5. 보호 필드 값은 원본에서 복원 (삼중 안전)
 * 6. YAML로 변환하여 저장
 */
function mergeConfig(currentConfig, requestedConfig) {
  // Step 1: 요청에서 보호 필드 제거
  const safeRequest = removeProtectedFields(requestedConfig);

  // Step 2: 현재 설정에 안전한 요청만 머지
  const merged = deepMerge(currentConfig, safeRequest);

  // Step 3: 보호 필드를 원본값으로 강제 복원
  for (const field of PROTECTED_FIELDS) {
    setNestedValue(merged, field, getNestedValue(currentConfig, field));
  }

  return merged;
}
```

### 3.4 보호 필드 삼중 검증 흐름

```
[서버 Backend]
  1차: 공통 설정 편집 UI에서 보호 필드 입력 자체를 차단
  2차: API에서 요청 수신 시 보호 필드 제거

[Config Agent]
  3차: 머지 시 보호 필드 원본값으로 강제 복원
```

### 3.5 systemd 서비스

```ini
# /etc/systemd/system/config-agent.service
[Unit]
Description=Smart Farm Config Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/smart-farm/config-agent
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=GATEWAY_ID={GATEWAY_ID}
Environment=MQTT_SERVER=mqtt://{SERVER_IP}:1883

[Install]
WantedBy=multi-user.target
```

## 4. Backend 설계 (NestJS)

### 4.1 모듈 구조

```
backend/src/modules/config-deploy/
├── config-deploy.module.ts
├── config-deploy.controller.ts
├── config-deploy.service.ts
├── config-deploy.types.ts          # ConfigRequest, ConfigResponse 타입
└── protected-fields.ts             # 보호 필드 목록 (Agent와 동일)
```

### 4.2 config-deploy.service.ts

```typescript
@Injectable()
export class ConfigDeployService {
  /** 응답 대기 맵: requestId → { resolve, reject, timeout } */
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(
    private mqttService: MqttService,
    private gatewayService: GatewayManagerService,
  ) {}

  /**
   * 특정 게이트웨이의 현재 설정 조회
   * 1. MQTT로 get_config 요청
   * 2. 응답 대기 (타임아웃 15초)
   * 3. 응답의 currentConfig 반환
   */
  async getConfig(gatewayId: string): Promise<Record<string, any>>;

  /**
   * 선택된 게이트웨이들에 설정 배포
   * 1. 요청 config에서 보호 필드 제거 (2차 검증)
   * 2. 각 게이트웨이에 순차적으로 update_config 요청
   * 3. 각 응답을 수집하여 결과 반환
   */
  async deployConfig(
    gatewayIds: string[],
    config: Record<string, any>,
    userId: string,
  ): Promise<DeployResult[]>;

  /**
   * MQTT 응답 핸들러 (farm/+/config/response 구독)
   * pendingRequests에서 매칭하여 resolve
   */
  handleConfigResponse(gatewayId: string, payload: ConfigResponse): void;
}
```

### 4.3 MqttService 확장

기존 `mqtt.service.ts`에 config 토픽 구독/발행 추가:

```typescript
// subscribeAll()에 추가
'farm/+/config/response'     // Config Agent 응답

// 신규 메서드
publishConfigRequest(gatewayId: string, request: ConfigRequest): void;

// routeMessage()에 추가
// rest === 'config/response' → configDeployService.handleConfigResponse()
```

### 4.4 API 엔드포인트

```typescript
@Controller('config-deploy')
@UseGuards(JwtAuthGuard)
export class ConfigDeployController {

  /** 공통 설정 템플릿 조회 (서버에 저장된 기본 설정) */
  @Get('template')
  getTemplate(): CommonConfigTemplate;

  /** 공통 설정 템플릿 수정 */
  @Put('template')
  updateTemplate(@Body() config: CommonConfigTemplate): CommonConfigTemplate;

  /** 특정 게이트웨이의 현재 설정 조회 (MQTT로 실시간 요청) */
  @Get('gateways/:gatewayId/config')
  getGatewayConfig(@Param('gatewayId') gatewayId: string): Promise<GatewayConfig>;

  /** 배포 미리보기 - 현재 설정 vs 변경될 설정 diff */
  @Post('preview')
  previewDeploy(@Body() body: {
    gatewayIds: string[];
    config: Record<string, any>;
  }): Promise<PreviewResult[]>;

  /** 배포 실행 */
  @Post('deploy')
  deploy(@Body() body: {
    gatewayIds: string[];
    config: Record<string, any>;
  }, @CurrentUser() user: any): Promise<DeployResult[]>;
}
```

### 4.5 응답 타입

```typescript
interface DeployResult {
  gatewayId: string;
  gatewayName: string;
  success: boolean;
  error?: string;
  changedFields?: string[];
  serviceRestarted?: boolean;
  duration: number;         // ms
}

interface PreviewResult {
  gatewayId: string;
  gatewayName: string;
  status: 'online' | 'offline' | 'no-agent';
  currentConfig?: Record<string, any>;
  diff?: {
    field: string;
    oldValue: any;
    newValue: any;
    protected: boolean;     // 보호 필드 여부
  }[];
}
```

## 5. Frontend 설계 (Vue 3)

### 5.1 파일 구조

```
frontend/src/
├── api/
│   └── config-deploy.api.ts         # API 클라이언트
├── views/
│   └── ConfigDeploy.vue             # 설정 배포 페이지
└── components/
    └── config-deploy/
        ├── ConfigEditor.vue          # YAML 설정 에디터
        ├── GatewaySelector.vue       # 게이트웨이 선택 체크박스
        ├── ConfigDiffViewer.vue      # Diff 미리보기
        └── DeployResultPanel.vue     # 배포 결과
```

### 5.2 페이지 흐름 (ConfigDeploy.vue)

```
┌─────────────────────────────────────────────┐
│  설정 배포                                   │
│                                              │
│  Step 1: 공통 설정 편집                       │
│  ┌────────────────────────────────────┐     │
│  │ homeassistant: false               │     │
│  │ frontend:                          │     │
│  │   port: 8080                       │     │
│  │ advanced:                          │     │
│  │   log_level: info  ← 수정 가능     │     │
│  │   channel: 11      ← 수정 가능     │     │
│  │ availability:                      │     │
│  │   active:                          │     │
│  │     timeout: 10                    │     │
│  └────────────────────────────────────┘     │
│  * 보호 필드(gateway ID, network_key 등)     │
│    은 편집 영역에 표시되지 않습니다            │
│                                              │
│  Step 2: 배포 대상 선택                       │
│  ┌────────────────────────────────────┐     │
│  │ [v] 전체 선택                       │     │
│  │ [v] farm01 - 1동 하우스 (online)    │     │
│  │ [v] farm02 - 2동 하우스 (online)    │     │
│  │ [ ] farm03 - 3동 하우스 (offline)   │     │
│  └────────────────────────────────────┘     │
│                                              │
│  [미리보기]  [배포 실행]                      │
│                                              │
│  Step 3: 미리보기 / 결과                      │
│  ┌────────────────────────────────────┐     │
│  │ farm01:                            │     │
│  │   advanced.log_level: info → debug │     │
│  │   advanced.channel: 11 → 15       │     │
│  │   🔒 mqtt.base_topic: (보호됨)     │     │
│  │   🔒 advanced.network_key: (보호됨) │     │
│  │                                    │     │
│  │ farm02:                            │     │
│  │   advanced.log_level: info → debug │     │
│  │   advanced.channel: 11 → 15       │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

### 5.3 config-deploy.api.ts

```typescript
export const configDeployApi = {
  getTemplate: () =>
    apiClient.get('/config-deploy/template'),

  updateTemplate: (config: Record<string, any>) =>
    apiClient.put('/config-deploy/template', config),

  getGatewayConfig: (gatewayId: string) =>
    apiClient.get(`/config-deploy/gateways/${gatewayId}/config`),

  preview: (gatewayIds: string[], config: Record<string, any>) =>
    apiClient.post('/config-deploy/preview', { gatewayIds, config }),

  deploy: (gatewayIds: string[], config: Record<string, any>) =>
    apiClient.post('/config-deploy/deploy', { gatewayIds, config }),
};
```

## 6. setup.sh 변경사항

기존 4단계에 Config Agent 설치를 5단계로 추가:

```bash
# ---- Step 5: Config Agent 설치 ----
log_info "Step 5/5: Config Agent 설치..."

CONFIG_AGENT_DIR="/opt/smart-farm/config-agent"
mkdir -p "$CONFIG_AGENT_DIR"

# config-agent 파일 복사
cp -r "$SCRIPT_DIR/config-agent/"* "$CONFIG_AGENT_DIR/"

# 의존성 설치
cd "$CONFIG_AGENT_DIR"
npm install --production

# systemd 서비스 등록
cat > /etc/systemd/system/config-agent.service << SERVICE
[Unit]
Description=Smart Farm Config Agent (${GATEWAY_ID})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${CONFIG_AGENT_DIR}
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=GATEWAY_ID=${GATEWAY_ID}
Environment=MQTT_SERVER=mqtt://${SERVER_IP}:1883
Environment=Z2M_CONFIG_PATH=/opt/zigbee2mqtt/data/configuration.yaml

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable config-agent
systemctl start config-agent
```

## 7. 보호 필드 상수 (공유)

Backend와 Config Agent 양쪽에서 동일하게 사용:

```typescript
// 보호 필드 경로 (dot notation)
export const PROTECTED_FIELDS = [
  'mqtt.base_topic',
  'mqtt.server',
  'mqtt.user',
  'mqtt.password',
  'advanced.network_key',
  'advanced.pan_id',
  'serial',              // serial 전체 (port, adapter)
  'devices',
  'groups',
] as const;
```

## 8. 에러 처리 및 타임아웃

| 상황 | 처리 |
|------|------|
| 게이트웨이 오프라인 | 15초 타임아웃 → `{ success: false, error: 'timeout' }` |
| Config Agent 미설치 | 응답 없음 → 타임아웃 동일 처리, UI에 "Agent 미설치" 안내 |
| YAML 문법 오류 | Config Agent에서 파싱 실패 → 에러 응답, 설정 미변경 |
| Z2M 재시작 실패 | Config Agent에서 감지 → 백업 복원 시도 → 결과 응답 |
| 보호 필드 변경 시도 | Backend 2차 + Agent 3차 검증에서 자동 제거, 로그 경고 |

## 9. 구현 순서

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | Config Agent (라즈베리파이) | `raspberry-pi/config-agent/*` |
| 2 | 보호 필드 상수 | `shared/protected-fields.ts` 또는 각 모듈 내 |
| 3 | Backend ConfigDeploy 모듈 | `backend/src/modules/config-deploy/*` |
| 4 | MqttService 확장 (config 토픽) | `backend/src/modules/mqtt/mqtt.service.ts` |
| 5 | Frontend API + 페이지 | `frontend/src/api/config-deploy.api.ts`, views, components |
| 6 | setup.sh 업데이트 | `raspberry-pi/setup.sh` |
| 7 | 라우터에 페이지 등록 | `frontend/src/router/index.ts` |
