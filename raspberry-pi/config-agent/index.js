'use strict';

const mqtt = require('mqtt');
const { execSync } = require('child_process');
const ConfigManager = require('./config-manager');

// ---- 환경 변수 ----
const GATEWAY_ID = process.env.GATEWAY_ID;
const MQTT_SERVER = process.env.MQTT_SERVER;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const Z2M_CONFIG_PATH = process.env.Z2M_CONFIG_PATH || '/opt/zigbee2mqtt/data/configuration.yaml';
const AGENT_VERSION = '1.0.0';

if (!GATEWAY_ID || !MQTT_SERVER) {
  console.error('[CONFIG-AGENT] GATEWAY_ID와 MQTT_SERVER 환경변수가 필요합니다.');
  process.exit(1);
}

const TOPIC_REQUEST = `farm/${GATEWAY_ID}/config/request`;
const TOPIC_RESPONSE = `farm/${GATEWAY_ID}/config/response`;
const TOPIC_AGENT_STATUS = `farm/${GATEWAY_ID}/agent/status`;
const TOPIC_TUNNEL_STATUS = `farm/${GATEWAY_ID}/tunnel/status`;

const configManager = new ConfigManager(Z2M_CONFIG_PATH);
let client;
let pendingRollbackRequestId = null;

// ---- MQTT 연결 ----
function connect() {
  console.log(`[CONFIG-AGENT] 연결 중: ${MQTT_SERVER} (게이트웨이: ${GATEWAY_ID})`);

  client = mqtt.connect(MQTT_SERVER, {
    clientId: `config-agent-${GATEWAY_ID}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    ...(MQTT_USERNAME && { username: MQTT_USERNAME }),
    ...(MQTT_PASSWORD && { password: MQTT_PASSWORD }),
  });

  client.on('connect', () => {
    console.log('[CONFIG-AGENT] MQTT Broker 연결 성공');

    // 롤백 대기 중이었다면 연결 복구 → 롤백 취소
    if (pendingRollbackRequestId) {
      console.log('[CONFIG-AGENT] 설정 변경 후 MQTT 재연결 성공 - 롤백 취소');
      configManager.cancelRollback();
      pendingRollbackRequestId = null;
    }

    client.subscribe(TOPIC_REQUEST, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[CONFIG-AGENT] 구독 실패: ${TOPIC_REQUEST}`, err.message);
      } else {
        console.log(`[CONFIG-AGENT] 구독: ${TOPIC_REQUEST}`);
      }
    });

    // 온라인 상태 즉시 발행
    publishAgentStatus('online');
    // 터널 상태 즉시 보고
    publishTunnelStatus();
    // 60초마다 하트비트 + 터널 상태
    if (!client._heartbeatTimer) {
      client._heartbeatTimer = setInterval(() => {
        publishAgentStatus('online');
        publishTunnelStatus();
      }, 60_000);
    }
  });

  client.on('message', (topic, payload) => {
    if (topic === TOPIC_REQUEST) {
      handleRequest(payload);
    }
  });

  client.on('error', (err) => {
    console.error('[CONFIG-AGENT] MQTT 오류:', err.message);
  });

  client.on('offline', () => {
    console.warn('[CONFIG-AGENT] MQTT 오프라인');
  });

  client.on('reconnect', () => {
    console.log('[CONFIG-AGENT] MQTT 재연결 시도...');
  });
}

// ---- 요청 처리 ----
async function handleRequest(payload) {
  let request;
  try {
    request = JSON.parse(payload.toString());
  } catch {
    console.error('[CONFIG-AGENT] 잘못된 JSON 페이로드');
    return;
  }

  const { requestId, action } = request;
  if (!requestId || !action) {
    console.error('[CONFIG-AGENT] requestId 또는 action 누락');
    return;
  }

  console.log(`[CONFIG-AGENT] 요청 수신: ${action} (${requestId})`);

  try {
    switch (action) {
      case 'get_config':
        handleGetConfig(requestId);
        break;
      case 'update_config':
        handleUpdateConfig(requestId, request.config || {});
        break;
      default:
        sendResponse(requestId, action, false, { error: `알 수 없는 action: ${action}` });
    }
  } catch (err) {
    console.error(`[CONFIG-AGENT] 처리 오류:`, err.message);
    sendResponse(requestId, action, false, { error: err.message });
  }
}

// ---- get_config: 현재 설정 조회 ----
function handleGetConfig(requestId) {
  const currentConfig = configManager.readConfig();
  sendResponse(requestId, 'get_config', true, { currentConfig });
}

// ---- update_config: 설정 업데이트 ----
function handleUpdateConfig(requestId, requestedConfig) {
  // 1. 머지 (보호 필드 삼중 검증)
  const { merged, changedFields } = configManager.mergeConfig(requestedConfig);

  if (changedFields.length === 0) {
    sendResponse(requestId, 'update_config', true, {
      currentConfig: merged,
      changedFields: [],
      serviceRestarted: false,
    });
    return;
  }

  // 2. 롤백 가드와 함께 설정 적용
  pendingRollbackRequestId = requestId;

  configManager.applyWithRollbackGuard(merged, () => {
    // 롤백 발생 시: Z2M 재시작하여 이전 설정 복원
    console.error('[CONFIG-AGENT] 자동 롤백 실행 - Zigbee2MQTT 재시작');
    restartZigbee2mqtt();
    pendingRollbackRequestId = null;
  });

  // 3. Zigbee2MQTT 재시작
  const restarted = restartZigbee2mqtt();

  // 4. 응답 (이 시점에서 MQTT 연결이 끊길 수 있음)
  //    연결이 유지되면 응답 전송 + 롤백 타이머는 connect 이벤트에서 해제됨
  sendResponse(requestId, 'update_config', true, {
    currentConfig: merged,
    changedFields,
    serviceRestarted: restarted,
  });

  // 5. 재시작 후 MQTT 연결이 유지되었으므로 롤백 불필요
  //    (만약 설정 변경으로 MQTT 연결이 끊기면 reconnect → connect 이벤트에서 처리)
  //    연결이 즉시 유지되는 경우 타이머 즉시 해제
  setTimeout(() => {
    if (client && client.connected && pendingRollbackRequestId === requestId) {
      console.log('[CONFIG-AGENT] 설정 적용 후 연결 유지 확인 - 롤백 타이머 해제');
      configManager.cancelRollback();
      pendingRollbackRequestId = null;
    }
  }, 10_000); // Z2M 재시작 후 10초 대기
}

// ---- Zigbee2MQTT 서비스 재시작 ----
function restartZigbee2mqtt() {
  try {
    execSync('systemctl restart zigbee2mqtt', { timeout: 30_000 });
    console.log('[CONFIG-AGENT] Zigbee2MQTT 재시작 완료');
    return true;
  } catch (err) {
    console.error('[CONFIG-AGENT] Zigbee2MQTT 재시작 실패:', err.message);
    return false;
  }
}

// ---- 응답 전송 ----
function sendResponse(requestId, action, success, extra = {}) {
  const response = {
    requestId,
    action,
    success,
    timestamp: new Date().toISOString(),
    agentVersion: AGENT_VERSION,
    ...extra,
  };

  if (client && client.connected) {
    client.publish(TOPIC_RESPONSE, JSON.stringify(response), { qos: 1 }, (err) => {
      if (err) {
        console.error('[CONFIG-AGENT] 응답 전송 실패:', err.message);
      } else {
        console.log(`[CONFIG-AGENT] 응답 전송: ${action} ${success ? '성공' : '실패'} (${requestId})`);
      }
    });
  } else {
    console.warn('[CONFIG-AGENT] MQTT 미연결 - 응답 전송 불가');
  }
}

// ---- Agent 상태 발행 ----
function publishAgentStatus(status) {
  if (client && client.connected) {
    client.publish(TOPIC_AGENT_STATUS, JSON.stringify({ status, timestamp: new Date().toISOString() }), { qos: 1 });
  }
}

// ---- 터널 상태 감지 및 발행 ----
function publishTunnelStatus() {
  if (!client || !client.connected) return;
  try {
    // reverse-ssh-tunnel 서비스 active 여부 확인
    const result = execSync('systemctl is-active reverse-ssh-tunnel.service 2>/dev/null || echo inactive').toString().trim();
    const status = result === 'active' ? 'connected' : 'disconnected';
    client.publish(TOPIC_TUNNEL_STATUS, JSON.stringify({ status, timestamp: new Date().toISOString() }), { qos: 1 });
  } catch {
    client.publish(TOPIC_TUNNEL_STATUS, JSON.stringify({ status: 'disconnected', timestamp: new Date().toISOString() }), { qos: 1 });
  }
}

// ---- 시작 ----
connect();

// 프로세스 종료 처리
process.on('SIGTERM', () => {
  console.log('[CONFIG-AGENT] 종료 중...');
  configManager.cancelRollback();
  if (client) client.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[CONFIG-AGENT] 종료 중...');
  configManager.cancelRollback();
  if (client) client.end();
  process.exit(0);
});
