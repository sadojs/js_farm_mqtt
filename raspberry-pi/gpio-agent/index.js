'use strict';

const mqtt   = require('mqtt');
const { spawn, execSync } = require('child_process');

const GATEWAY_ID  = process.env.GATEWAY_ID   || 'lgw-dev';
const MQTT_SERVER = process.env.MQTT_SERVER   || 'mqtt://localhost:1883';
const MQTT_USER   = process.env.MQTT_USERNAME || '';
const MQTT_PASS   = process.env.MQTT_PASSWORD || '';
// 릴레이 모듈이 active-low인 경우 true (연결 시 자동 ON되는 모듈)
const ACTIVE_LOW  = process.env.GPIO_ACTIVE_LOW === 'true';
// gpiochip 번호 (RPi 5는 gpiochip4, RPi 3B/4는 gpiochip0)
const GPIO_CHIP   = process.env.GPIO_CHIP || 'gpiochip0';
// 오픈드레인 모드: VCC=5V 릴레이에서 3.3V GPIO로 완전 제어 가능 (권장)
// LOW=drain 활성(릴레이 ON), HIGH=high-Z(릴레이 보드 내부 풀업→5V→릴레이 OFF)
const OPEN_DRAIN  = process.env.GPIO_OPEN_DRAIN === 'true';

const TOPIC_RELAY  = `farm/${GATEWAY_ID}/gpio/relay`;
const TOPIC_STATUS = `farm/${GATEWAY_ID}/gpio/status`;

// BCM 2~27 (26핀) 모두 허용. 외부 전원 릴레이 사용 시 시스템 핀도 일반 GPIO로 사용 가능.
// I2C/SPI/UART는 raspi-config에서 비활성화하거나 dtoverlay로 일반 GPIO 모드 설정 필요.
const BCM_VALID = new Set([
  2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
  17,18,19,20,21,22,23,24,25,26,27,
]);

// 시작 시 OFF 초기화할 핀 목록 (쉼표 구분). 예: GPIO_INIT_PINS=17,27
const GPIO_INIT_PINS = (process.env.GPIO_INIT_PINS || '')
  .split(',').map(s => parseInt(s.trim())).filter(n => BCM_VALID.has(n));

// ── 시작 시 이전 gpioset 고아 프로세스 정리 ────────────────────────────
// gpio-agent 재시작 시 이전 gpioset이 GPIO 칩을 점유("Device or resource busy")하는 문제 해결
try {
  execSync(`pkill -9 -f "gpioset.*${GPIO_CHIP}"`, { stdio: 'ignore' });
  // 프로세스가 완전히 종료될 때까지 짧게 대기
  execSync('sleep 0.3');
} catch {}

// 핀별 gpioset 프로세스 (상태 유지)
const pinProcs = new Map();
// 핀별 자동해제 타이머
const pinTimers = new Map();
// 핀별 마지막 논리 ON 상태 (인터록 판단용)
const pinOn = new Map();

// ── 하드웨어 인터록 (개폐기 열기/닫기 동시 ON 방지 = 쇼트/모터 역가압 방어) ──
// 두 핀이 물리적으로 동시에 ON 되면 절대 안 된다. 어떤 명령이 오더라도 한 핀을 ON 하기
// 전에 인터록 파트너 핀을 반드시 먼저 OFF 시킨다. 파트너 정보 출처(누적):
//   (1) env GPIO_INTERLOCK_PAIRS="22:27,23:24"  (고정 배선 — 서버와 무관한 최종 방어선)
//   (2) 명령 payload의 interlockPin  (서버가 쌍을 알려줌 → 자동 학습)
const interlockMap = new Map(); // pin -> 파트너 pin (양방향)
function linkInterlock(a, b) {
  if (!BCM_VALID.has(a) || !BCM_VALID.has(b) || a === b) return;
  interlockMap.set(a, b);
  interlockMap.set(b, a);
}
(process.env.GPIO_INTERLOCK_PAIRS || '').split(',').forEach((seg) => {
  const [a, b] = seg.split(':').map((s) => parseInt(s.trim(), 10));
  if (Number.isInteger(a) && Number.isInteger(b)) linkInterlock(a, b);
});
// 파트너 강제 OFF 후 물리 릴레이가 실제로 떨어질 때까지 대기(ms) — 동시 ON 구간 제거.
const INTERLOCK_SETTLE_MS = parseInt(process.env.GPIO_INTERLOCK_SETTLE_MS || '250', 10);

/**
 * BCM 핀을 특정 level(0/1)로 설정하고 프로세스를 유지.
 * 기존 프로세스가 있으면 exit 대기 후 새 프로세스 스폰 (race condition 방지).
 */
function setPin(pin, level) {
  const old = pinProcs.get(pin);

  function spawnGpioSet() {
    // 이미 다른 pending 요청이 있으면 건너뜀 (가장 최근 level만 적용)
    if (pinProcs.get(pin) !== old && pinProcs.has(pin)) return;

    // 오픈드레인 + 풀업: 3.3V GPIO로 5V VCC 옵토커플러 완전 차단 가능
    // - LOW: GPIO 0V → 옵토커플러 ON
    // - HIGH-Z + pull-up: IN 핀 ~3.79V → 옵토커플러 OFF (전류 0.01mA)
    const args = [
      ...(OPEN_DRAIN ? ['--drive', 'open-drain', '--bias', 'pull-up'] : []),
      '--consumer', `gpio-agent-${GATEWAY_ID}`,
      '-c', GPIO_CHIP,
      `${pin}=${level}`,
    ];
    const proc = spawn('gpioset', args, { stdio: 'ignore' });

    proc.on('error', (err) => {
      console.error(`[GPIO] BCM ${pin} gpioset 오류: ${err.message}`);
      if (pinProcs.get(pin) === proc) pinProcs.delete(pin);
    });
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[GPIO] BCM ${pin} gpioset 종료 코드: ${code}`);
      }
      if (pinProcs.get(pin) === proc) pinProcs.delete(pin);
    });

    pinProcs.set(pin, proc);
  }

  if (old) {
    // 기존 프로세스가 exit하면 즉시 새 프로세스 스폰
    old.once('exit', spawnGpioSet);
    pinProcs.delete(pin);
    try { old.kill('SIGTERM'); } catch {}
  } else {
    spawnGpioSet();
  }
}

/**
 * 릴레이 제어: state(true=ON, false=OFF) → active-low 보정 포함
 */
function relaySet(pin, state) {
  const level = ACTIVE_LOW ? (state ? 0 : 1) : (state ? 1 : 0);
  setPin(pin, level);
  console.log(`[GPIO] BCM ${pin} → ${state ? 'ON' : 'OFF'} (level=${level}${ACTIVE_LOW ? ', active-low' : ''})`);
}

const opts = {
  clientId: `gpio-agent-${GATEWAY_ID}-${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000,
};
if (MQTT_USER) {
  opts.username = MQTT_USER;
  opts.password = MQTT_PASS;
}

const client = mqtt.connect(MQTT_SERVER, opts);

client.on('connect', () => {
  console.log(`[MQTT] 연결 성공: ${MQTT_SERVER}`);
  client.subscribe(TOPIC_RELAY, { qos: 1 }, (err) => {
    if (err) console.error('[MQTT] 구독 실패:', err.message);
    else console.log(`[MQTT] 구독: ${TOPIC_RELAY}`);
  });
});

client.on('error',     (err) => console.error('[MQTT] 오류:', err.message));
client.on('reconnect', ()    => console.warn('[MQTT] 재연결 시도 중...'));

client.on('message', (topic, payload) => {
  if (topic !== TOPIC_RELAY) return;
  handleRelayCommand(payload.toString());
});

function clearPinTimer(pin) {
  if (pinTimers.has(pin)) { clearTimeout(pinTimers.get(pin)); pinTimers.delete(pin); }
}

function publishStatus(obj) {
  client.publish(TOPIC_STATUS, JSON.stringify({ timestamp: new Date().toISOString(), ...obj }), { qos: 1 });
}

// 모든 릴레이 명령을 단일 큐로 직렬화 — 인터록(파트너 OFF→대기→자기 ON) 시퀀스가
// 다른 명령과 인터리빙되지 않도록 원자적으로 처리한다.
let cmdQueue = Promise.resolve();

function handleRelayCommand(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch {
    console.warn('[GPIO] 잘못된 JSON:', raw);
    return;
  }
  cmdQueue = cmdQueue
    .then(() => processRelayCommand(msg))
    .catch((err) => console.error('[GPIO] 명령 처리 오류:', err && err.message ? err.message : err));
}

async function processRelayCommand(msg) {
  const { slot, pin, state, durationMs, requestId, interlockPin } = msg;

  if (!BCM_VALID.has(pin)) {
    console.warn(`[GPIO] 유효하지 않은 핀: BCM ${pin}`);
    return;
  }

  // 서버가 파트너 핀을 알려주면 인터록 쌍으로 학습(양방향)
  if (Number.isInteger(interlockPin)) linkInterlock(pin, interlockPin);

  // 기존 자동해제 타이머 취소
  clearPinTimer(pin);

  // ── 하드웨어 인터록: 이 핀을 ON 하기 전에 파트너 핀을 반드시 먼저 OFF ──
  // (state=false, 즉 OFF 명령은 언제나 안전하므로 인터록 불필요.)
  if (state === true) {
    const partner = interlockMap.get(pin);
    // 파트너가 ON(또는 상태 미상)이면 강제 OFF + 물리 릴레이 해제 대기.
    if (partner != null && pinOn.get(partner) !== false) {
      clearPinTimer(partner);
      relaySet(partner, false);
      pinOn.set(partner, false);
      console.log(`[GPIO] 🔒 인터록: BCM ${pin} ON 전 파트너 BCM ${partner} 강제 OFF`);
      publishStatus({ slot: 'interlock', pin: partner, state: false, interlock: true });
      await new Promise((r) => setTimeout(r, INTERLOCK_SETTLE_MS));
    }
  }

  relaySet(pin, state);
  pinOn.set(pin, state === true);

  publishStatus({ requestId, slot, pin, state });

  // 자동 해제
  if (durationMs && durationMs > 0 && state) {
    const timer = setTimeout(() => {
      pinTimers.delete(pin);
      relaySet(pin, false);
      pinOn.set(pin, false);
      console.log(`[GPIO] BCM ${pin} (${slot}) → OFF (자동해제)`);
      publishStatus({ slot, pin, state: false, auto: true });
    }, durationMs);
    pinTimers.set(pin, timer);
  }
}

function cleanup() {
  console.log('[GPIO] 종료 처리 중...');
  pinTimers.forEach(t => clearTimeout(t));
  pinProcs.forEach((proc, pin) => {
    try { proc.kill('SIGTERM'); } catch {}
    console.log(`[GPIO] BCM ${pin} → 종료`);
  });
  setTimeout(() => { client.end(); process.exit(0); }, 300);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT',  cleanup);

console.log(`[gpio-agent] 시작 — GATEWAY_ID=${GATEWAY_ID} CHIP=${GPIO_CHIP} ACTIVE_LOW=${ACTIVE_LOW} OPEN_DRAIN=${OPEN_DRAIN}`);

// 시작 시 지정 핀 OFF 초기화 (릴레이 안전 상태)
if (GPIO_INIT_PINS.length > 0) {
  const offLevel = ACTIVE_LOW ? 1 : 0;
  GPIO_INIT_PINS.forEach(pin => {
    setPin(pin, offLevel);
    pinOn.set(pin, false);
    console.log(`[GPIO] BCM ${pin} 초기화 → OFF (level=${offLevel})`);
  });
}
