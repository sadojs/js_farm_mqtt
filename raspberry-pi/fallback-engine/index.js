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

const fs = require('fs');
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
// 비상 정지 유지(래치) 파일 — 존재하면 해제 전까지 모든 릴레이 ON 금지(재부팅 후에도 유지). gpio-agent 도 같은 파일을 본다.
const EMERGENCY_LATCH_PATH = process.env.EMERGENCY_LATCH_PATH || `${DATA_DIR}/emergency.json`;
// 방재(밀폐) 종료 시각 — 서버 단절 중에도 방재 중이면 환기팬·개폐기 폴백 룰을 멈춘다.
const PROTECTION_PATH = process.env.PROTECTION_PATH || `${DATA_DIR}/protection.json`;

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
const T_EMERGENCY_STOP = `farm/${GATEWAY_ID}/gpio/emergency-stop`;       // 구형 1회 정지(호환)
const T_EMERGENCY = `farm/${GATEWAY_ID}/gpio/emergency`;                  // 정지 유지 상태(retained, {active})
const T_EMERGENCY_STATE = `farm/${GATEWAY_ID}/gpio/emergency/state`;      // Pi → 서버 적용 확인
const T_PROTECTION = `farm/${GATEWAY_ID}/fallback/protection`;            // 방재 종료 시각(retained, {until})
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
let handedOver = false; // 서버 복귀(grace) 시 제어권 인계를 이미 했는지

// ── 비상 정지 래치 / 방재 상태 (파일 영속) ─────────────────────
function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')); } catch { return null; }
}
function writeJson(path, obj) {
  try { fs.writeFileSync(path, JSON.stringify(obj)); } catch (e) { console.error(`[FALLBACK] ${path} 저장 실패: ${e.message}`); }
}
let emergencyLatched = !!readJson(EMERGENCY_LATCH_PATH)?.active;
let protectionUntilMs = (() => { const u = readJson(PROTECTION_PATH)?.until; const t = u ? Date.parse(u) : NaN; return Number.isFinite(t) ? t : 0; })();
if (emergencyLatched) console.warn('[FALLBACK] 부팅: 비상 정지 유지 중 — 해제 전까지 릴레이 ON 금지');
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
  relayBridge.latched = emergencyLatched;
  evaluator = new RuleEvaluator({
    store, queue, rain, relayBridge, gatewayId: GATEWAY_ID,
  });
  rainGpio = new RainGpio({ client, gatewayId: GATEWAY_ID, chip: process.env.GPIO_CHIP });

  client.on('connect', () => {
    console.log('[FALLBACK] MQTT 연결 성공');
    const topics = [
      T_HEARTBEAT, T_RULES_SYNC, T_GPIO_RELAY, T_EMERGENCY_STOP, T_EMERGENCY, T_PROTECTION, T_GPIO_STATUS,
      `${T_Z2M_PREFIX}+`,
    ];
    topics.forEach((t) => client.subscribe(t, { qos: 1 }, (err) => {
      if (err) console.error(`[FALLBACK] 구독 실패: ${t} ${err.message}`);
      else console.log(`[FALLBACK] 구독: ${t}`);
    }));

    // 초기 모드 publish
    publishMode();
    // 현재 비상 정지 유지 상태 회신 (서버가 Pi 실제 상태를 알 수 있게)
    publishEmergencyState();

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
    // 서버/gpio-agent 는 'slot' 필드를 쓴다(구형 'channel' 호환). 이전엔 channel 만 봐서 상태가 비어
    // 폴백 관수 최대가동 안전망이 동작하지 않았다.
    const ch = cmd?.slot ?? cmd?.channel;
    if (ch && typeof cmd.state === 'boolean') {
      evaluator.recordChannelState(ch, cmd.state);
    }
    return;
  }

  // 4-a) 비상 정지 유지 상태 (retained) — 재접속·재부팅 후에도 서버 상태를 다시 받는다
  if (topic === T_EMERGENCY) {
    let msg;
    try { msg = JSON.parse(payload.toString('utf-8')); } catch { return; }
    setEmergencyLatch(!!msg?.active, msg);
    return;
  }

  // 4-b) 방재 종료 시각 (retained)
  if (topic === T_PROTECTION) {
    let msg;
    try { msg = JSON.parse(payload.toString('utf-8')); } catch { return; }
    const t = msg?.until ? Date.parse(msg.until) : NaN;
    protectionUntilMs = Number.isFinite(t) ? t : 0;
    writeJson(PROTECTION_PATH, { until: protectionUntilMs ? new Date(protectionUntilMs).toISOString() : null });
    console.log(`[FALLBACK] 방재 상태: ${protectionUntilMs > Date.now() ? `~${new Date(protectionUntilMs).toISOString()}` : '없음'}`);
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
    const ch = s?.slot ?? s?.channel;
    if (ch && typeof s.state === 'boolean') {
      evaluator.recordChannelState(ch, s.state);
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

/**
 * 비상 정지 유지 적용/해제.
 *  적용: 래치 파일 기록 → RelayBridge ON 차단 → 모든 릴레이 OFF → 폴백 룰 평가 중지
 *  해제: 래치 파일 삭제 → ON 허용 (장비는 꺼진 상태 그대로, 다시 켜는 건 서버 자동제어/사용자)
 */
function setEmergencyLatch(active, meta) {
  const changed = active !== emergencyLatched;
  emergencyLatched = active;
  if (relayBridge) relayBridge.latched = active;
  if (active) {
    writeJson(EMERGENCY_LATCH_PATH, { active: true, by: meta?.by || null, reason: meta?.reason || null, at: meta?.ts || new Date().toISOString() });
    // 이미 래치 중이어도(재접속 시 retained 재수신) OFF 는 한 번 더 보내 안전하게
    evaluator.emergencyStopAll();
    if (changed) console.warn(`[FALLBACK] 비상 정지 유지 적용 (by ${meta?.by || '?'})`);
  } else {
    try { fs.unlinkSync(EMERGENCY_LATCH_PATH); } catch {}
    if (changed) console.warn(`[FALLBACK] 비상 정지 해제 (by ${meta?.by || '?'})`);
  }
  if (changed) {
    queue.enqueue({
      eventType: active ? 'emergency_latched' : 'emergency_released',
      payload: { by: meta?.by || null, reason: meta?.reason || null },
      occurredAt: new Date().toISOString(),
    });
    flushQueue();
  }
  publishEmergencyState();
}

function publishEmergencyState() {
  if (!client?.connected) return;
  client.publish(T_EMERGENCY_STATE, JSON.stringify({ active: emergencyLatched, ts: new Date().toISOString() }), { qos: 1, retain: true });
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
          handedOver = false;
          flushQueue();
          evaluator.onExitFallback(); // 폴백 관수 예약 취소 + 폴백이 켠 관수 채널 OFF → 온라인 스케줄러 인계
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
      if (fsm.mode === 'fallback' && !fsm.serverBack()) {
        if (rainState === 'active') evaluator.applyRainOverride(true);
        else if (rainState === 'inactive') evaluator.applyRainOverride(false);
      }

      // 2-b) 서버 복귀(grace) 시작 순간 — 제어권 인계: 폴백 관수 예약 취소 + 폴백이 켠 관수 OFF (1회)
      const serverBack = fsm.serverBack();
      if (serverBack && !handedOver) {
        console.log('[FALLBACK] 서버 하트비트 복귀 — 제어권 서버로 인계 (온라인 표시는 grace 후)');
        evaluator.onExitFallback();
        handedOver = true;
      }
      if (!serverBack && fsm.mode === 'fallback') handedOver = false;

      // 3) 폴백 모드면 룰 평가 — 비상 정지 유지 중·서버 복귀 대기 중엔 평가하지 않음
      if (fsm.mode === 'fallback' && !serverBack && !emergencyLatched) {
        evaluator.evaluate(new Date(), { protectionActive: protectionUntilMs > Date.now() });
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
