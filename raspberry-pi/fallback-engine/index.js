'use strict';

/**
 * Smart Farm Fallback Engine (RPi 이머전시 페일오버)
 *
 * 서버와 통신이 단절되면 RPi가 로컬 룰로 작물 안전 동작을 수행한다.
 * 정상 통신 중에는 idle 상태 (서버 자동화 룰 그대로 동작).
 *
 * - heartbeat-watchdog : farm/{gw}/server/heartbeat 수신 감시
 * - mode-state-machine : online ↔ fallback 전환
 * - rule-evaluator     : opener/irrigation/fertilizer/fan 4종 룰 평가
 * - command-gate       : 폴백 중 서버 gpio/relay 명령 차단
 * - rain-override      : 빗물 센서 ACTIVE → 모든 모드에서 개폐기 강제 CLOSE
 * - event-queue        : 폴백 이벤트 SQLite 큐 → 복구 시 일괄 전송
 */

const mqtt = require('mqtt');
const RuleStore = require('./lib/rule-store');
const HeartbeatWatchdog = require('./lib/heartbeat-watchdog');
const ModeStateMachine = require('./lib/mode-state-machine');
const CommandGate = require('./lib/command-gate');
const EventQueue = require('./lib/event-queue');
const RuleEvaluator = require('./lib/rule-evaluator');
const RainOverride = require('./lib/rain-override');
const RainGpio = require('./lib/rain-gpio');
const RelayBridge = require('./lib/relay-bridge');

// ── 환경 변수 ────────────────────────────────────────────────
const GATEWAY_ID = process.env.GATEWAY_ID;
const MQTT_SERVER = process.env.MQTT_SERVER;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const DATA_DIR = process.env.FALLBACK_DATA_DIR || '/var/lib/smartfarm/fallback';
const RULES_PATH = process.env.FALLBACK_RULES_PATH || `${DATA_DIR}/rules.json`;
const DB_PATH = process.env.FALLBACK_DB_PATH || `${DATA_DIR}/fallback.db`;
const EVAL_INTERVAL_MS = parseInt(process.env.FALLBACK_EVAL_INTERVAL_MS || '30000', 10);

if (!GATEWAY_ID || !MQTT_SERVER) {
  console.error('[FALLBACK] GATEWAY_ID와 MQTT_SERVER 환경변수가 필요합니다.');
  process.exit(1);
}

// ── 토픽 ─────────────────────────────────────────────────────
const T_HEARTBEAT = `farm/${GATEWAY_ID}/server/heartbeat`;
const T_RULES_SYNC = `farm/${GATEWAY_ID}/fallback/rules/sync`;
const T_MODE = `farm/${GATEWAY_ID}/fallback/mode`;
const T_EVENTS = `farm/${GATEWAY_ID}/fallback/events`;
const T_ACK = `farm/${GATEWAY_ID}/fallback/ack`;
const T_GPIO_RELAY = `farm/${GATEWAY_ID}/gpio/relay`;
const T_EMERGENCY_STOP = `farm/${GATEWAY_ID}/gpio/emergency-stop`;
const T_GPIO_STATUS = `farm/${GATEWAY_ID}/gpio/status`;
// 센서 데이터 (온도/빗물): z2m 토픽 패턴 farm/{gw}/z2m/{device}
const T_Z2M_PREFIX = `farm/${GATEWAY_ID}/z2m/`;

// ── 모듈 초기화 ───────────────────────────────────────────────
const store = new RuleStore({ rulesPath: RULES_PATH, dbPath: DB_PATH });
const queue = new EventQueue({ dbPath: DB_PATH });
const watchdog = new HeartbeatWatchdog({
  timeoutSeconds: () => store.config().heartbeatTimeoutSeconds,
  graceSeconds: () => store.config().recoveryGraceSeconds,
});
const fsm = new ModeStateMachine({ watchdog });
const gate = new CommandGate({ fsm, queue, gatewayId: GATEWAY_ID });
const rain = new RainOverride();

let client;
let evalTimer = null;
let relayBridge;
let evaluator;
let rainGpio;

// ── MQTT 연결 ────────────────────────────────────────────────
function connect() {
  console.log(`[FALLBACK] 연결 중: ${MQTT_SERVER} (gw=${GATEWAY_ID})`);

  client = mqtt.connect(MQTT_SERVER, {
    clientId: `fallback-engine-${GATEWAY_ID}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    ...(MQTT_USERNAME && { username: MQTT_USERNAME }),
    ...(MQTT_PASSWORD && { password: MQTT_PASSWORD }),
  });

  relayBridge = new RelayBridge({ client, gatewayId: GATEWAY_ID, store });
  evaluator = new RuleEvaluator({
    store, queue, rain, relayBridge, gatewayId: GATEWAY_ID,
  });
  rainGpio = new RainGpio({ client, gatewayId: GATEWAY_ID, chip: process.env.GPIO_CHIP });

  client.on('connect', () => {
    console.log('[FALLBACK] MQTT 연결 성공');
    const topics = [
      T_HEARTBEAT, T_RULES_SYNC, T_GPIO_RELAY, T_EMERGENCY_STOP, T_GPIO_STATUS,
      `${T_Z2M_PREFIX}+`,
    ];
    topics.forEach((t) => client.subscribe(t, { qos: 1 }, (err) => {
      if (err) console.error(`[FALLBACK] 구독 실패: ${t} ${err.message}`);
      else console.log(`[FALLBACK] 구독: ${t}`);
    }));

    // 초기 모드 publish
    publishMode();

    // 우적센서 GPIO 감시 시작 (rainInput.enabled 에 따라)
    rainGpio.applyConfig(store.config().rainInput);

    // 폴백 중 누적된 이벤트 flush 시도
    flushQueue();
  });

  client.on('message', (topic, payload) => {
    try {
      handleMessage(topic, payload);
    } catch (err) {
      console.error(`[FALLBACK] 메시지 처리 오류 (${topic}): ${err.message}`);
    }
  });

  client.on('error', (err) => console.error(`[FALLBACK] MQTT 오류: ${err.message}`));
  client.on('reconnect', () => console.log('[FALLBACK] 재연결 시도...'));
}

function handleMessage(topic, payload) {
  // 1) 서버 하트비트
  if (topic === T_HEARTBEAT) {
    watchdog.touch();
    return;
  }

  // 2) 룰 동기화 (retained 메시지)
  if (topic === T_RULES_SYNC) {
    const parsed = JSON.parse(payload.toString('utf-8'));
    store.applySync(parsed);
    publishAck(parsed.version);
    // 우적센서 설정 변화 반영 (활성/비활성/핀)
    if (rainGpio) rainGpio.applyConfig(store.config().rainInput);
    console.log(`[FALLBACK] 룰 동기화 적용 v${parsed.version}`);
    return;
  }

  // 3) GPIO relay 명령 (server → RPi)
  if (topic === T_GPIO_RELAY) {
    let cmd;
    try { cmd = JSON.parse(payload.toString('utf-8')); }
    catch { return; }
    const allowed = gate.shouldExecute(cmd);
    if (!allowed) {
      // 폴백 모드 — 드롭 + 로그
      console.log('[FALLBACK] 서버 GPIO 명령 차단 (폴백 모드)');
      return;
    }
    // online 모드 — 평가기에 관수 ON timestamp 등록
    if (cmd?.channel && typeof cmd.state === 'boolean') {
      evaluator.recordChannelState(cmd.channel, cmd.state);
    }
    return;
  }

  // 4) emergency-stop — 항상 통과
  if (topic === T_EMERGENCY_STOP) {
    console.warn('[FALLBACK] EMERGENCY STOP 수신');
    evaluator.emergencyStopAll();
    return;
  }

  // 5) GPIO 응답 — 채널 상태 미러
  if (topic === T_GPIO_STATUS) {
    let s;
    try { s = JSON.parse(payload.toString('utf-8')); }
    catch { return; }
    if (s?.channel && typeof s.state === 'boolean') {
      evaluator.recordChannelState(s.channel, s.state);
    }
    return;
  }

  // 6) z2m 센서 데이터 — 온도/빗물 추출
  if (topic.startsWith(T_Z2M_PREFIX)) {
    const deviceName = topic.slice(T_Z2M_PREFIX.length);
    if (deviceName.includes('/')) return; // bridge/availability 등 제외
    let data;
    try { data = JSON.parse(payload.toString('utf-8')); }
    catch { return; }
    evaluator.ingestSensor(deviceName, data);
    // 빗물 override 는 '구성된 우적센서(rainInput)'가 활성일 때 그 센서만 신뢰한다.
    // 비활성이거나 다른 zigbee 우적 장치(예: 0xa4c1…)의 z2m 데이터는 무시 →
    // 게이트웨이 환경설정에서 비활성화한 센서가 개폐기를 오작동으로 닫는 문제 방지.
    const rainCfg = store.config().rainInput || {};
    if (rainCfg.enabled && deviceName === rainCfg.friendlyName) {
      rain.ingestSensor(deviceName, data);
    }
    return;
  }
}

function publishMode() {
  if (!client?.connected) return;
  const payload = JSON.stringify({
    mode: fsm.mode,
    since: fsm.modeChangedAt.toISOString(),
  });
  client.publish(T_MODE, payload, { qos: 1, retain: true });
}

function publishAck(version) {
  if (!client?.connected) return;
  client.publish(
    T_ACK,
    JSON.stringify({ version, appliedAt: new Date().toISOString() }),
    { qos: 1 },
  );
}

function flushQueue() {
  if (!client?.connected) return;
  const events = queue.drain(100);
  if (events.length === 0) return;
  client.publish(
    T_EVENTS,
    JSON.stringify({ events }),
    { qos: 1 },
    (err) => {
      if (err) {
        console.error(`[FALLBACK] 이벤트 전송 실패: ${err.message}`);
        // 실패 시 다시 큐로 (간단히 무시 — drain이 readonly로 변경되면 reinsert)
      } else {
        console.log(`[FALLBACK] 이벤트 전송: ${events.length}건`);
        queue.markFlushed(events.map((e) => e.id));
      }
    },
  );
}

// ── 메인 루프 ────────────────────────────────────────────────
function startEvaluationLoop() {
  if (evalTimer) clearInterval(evalTimer);
  evalTimer = setInterval(() => {
    try {
      // 1) 모드 전환 체크
      const newMode = watchdog.evaluate();
      const changed = fsm.tryTransition(newMode);
      if (changed) {
        console.log(`[FALLBACK] 모드 전환: ${fsm.mode}`);
        queue.enqueue({
          eventType: 'mode_change',
          payload: { to: fsm.mode },
          occurredAt: new Date().toISOString(),
        });
        publishMode();
        if (fsm.mode === 'online') {
          flushQueue();
          evaluator.onExitFallback(); // 폴백 관수 예약 타이머 취소 → 온라인 스케줄러 인계
          evaluator.applyRainOverride(false); // 폴백이 걸어둔 빗물 강제닫힘 해제 → 서버 인계
        }

        // rpi-fallback-channel-sync: 폴백 진입 시 채널 매핑이 없으면 안전망 발행
        if (fsm.mode === 'fallback' && !store.channelMapping()) {
          console.error('[FALLBACK] channelMapping 미동기화 — emergencyStopAll 발행 (safe-off)');
          evaluator.emergencyStopAll();
        }
      }

      // 2) 빗물 override — 폴백 모드에서만 적용(서버 단절 시 작물보호 안전망).
      //    online 중엔 서버 rain-override가 담당하며 사용자 '비감지자동제어' 토글을 존중하므로,
      //    fallback 은 개입하지 않는다(index.js 상단 원칙: 정상 통신 중엔 idle).
      const rainState = rain.state();
      if (fsm.mode === 'fallback') {
        if (rainState === 'active') evaluator.applyRainOverride(true);
        else if (rainState === 'inactive') evaluator.applyRainOverride(false);
      }

      // 3) 폴백 모드면 룰 평가
      if (fsm.mode === 'fallback') {
        evaluator.evaluate(new Date());
      }
    } catch (err) {
      console.error(`[FALLBACK] 평가 루프 오류: ${err.message}`);
    }
  }, EVAL_INTERVAL_MS);
}

// ── Graceful shutdown ────────────────────────────────────────
function shutdown(sig) {
  console.log(`[FALLBACK] 종료 신호: ${sig}`);
  if (evalTimer) clearInterval(evalTimer);
  try { if (rainGpio) rainGpio.stop(); } catch {}
  try { queue.close(); } catch {}
  if (client) client.end(false, () => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── 부트스트랩 ───────────────────────────────────────────────
store.load();
queue.init();
connect();
startEvaluationLoop();
console.log('[FALLBACK] fallback-engine started');
