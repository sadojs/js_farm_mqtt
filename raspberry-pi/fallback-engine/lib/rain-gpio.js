'use strict';

const { execFile } = require('child_process');

/**
 * 무전압(dry contact) 우적센서 GPIO 감시기.
 *
 * 라즈베리파이 헤더 40번(BCM21) + 39번(GND)에 접점을 직결하고 내부 풀업을 사용한다.
 *  - 접점 열림(비 없음) → 라인 HIGH ("active")
 *  - 접점 닫힘(비)      → 라인 LOW  ("inactive")  ← activeLow=true 기준 비 감지
 *
 * libgpiod v2 (gpio-agent 가 `gpioset -c <chip>` 사용 → v2 확정) 의 `gpioget` 으로
 * 주기 폴링하며, 디바운스(연속 STABLE_SAMPLES회 동일값)로 채터링을 제거한다.
 * 상태 변화 시 로컬 브로커로 farm/{gw}/z2m/{friendlyName} 에 {"rain":bool} 를 발행하고,
 * 늦게 접속한 백엔드도 상태를 알 수 있도록 주기적으로 재발행한다.
 *
 * 이 메시지는 fallback-engine 자신(z2m 구독)과 온라인 시 백엔드 양쪽이 소비하므로
 * 별도 배선/브릿지 없이 기존 우적 로직(오프라인 강제 닫힘 + 서버 rain-override)이 동작한다.
 */

const POLL_MS = 1000;          // 폴링 주기
const STABLE_SAMPLES = 3;      // 상태 확정에 필요한 연속 동일 샘플 수 (~3초 디바운스)
const REPUBLISH_MS = 60000;    // 변화 없어도 재발행 주기 (백엔드 late-join 대비)

class RainGpio {
  constructor({ client, gatewayId, chip }) {
    this.client = client;
    this.gatewayId = gatewayId;
    this.chip = chip || process.env.GPIO_CHIP || 'gpiochip0';

    this.enabled = false;
    this.pin = 21;
    this.activeLow = true;
    this.friendlyName = 'rain_sensor';

    this.timer = null;
    this.pending = null;       // 디바운스 중인 후보 상태
    this.pendingCount = 0;
    this.state = null;         // 확정된 rain 상태 (true/false), 초기 null
    this.lastPublishAt = 0;
    this.errorLoggedAt = 0;
  }

  /**
   * 서버 config sync 로 받은 rainInput 을 반영. enabled 전환 시 감시 시작/중단.
   */
  applyConfig(rainInput) {
    const cfg = rainInput || {};
    const enabled = !!cfg.enabled;
    const pin = Number.isInteger(cfg.pin) ? cfg.pin : 21;
    const activeLow = cfg.activeLow !== false; // 기본 true
    const friendlyName = cfg.friendlyName || 'rain_sensor';

    const changed =
      enabled !== this.enabled || pin !== this.pin ||
      activeLow !== this.activeLow || friendlyName !== this.friendlyName;

    this.pin = pin;
    this.activeLow = activeLow;
    this.friendlyName = friendlyName;

    if (enabled && (!this.enabled || changed)) {
      this.enabled = true;
      this._restart();
    } else if (!enabled && this.enabled) {
      this.enabled = false;
      this.stop();
      console.log('[RAIN-GPIO] 비활성화 — 감시 중단');
    }
  }

  _restart() {
    this.stop();
    // 상태 초기화 (핀/설정 변경 후 재평가)
    this.pending = null;
    this.pendingCount = 0;
    this.state = null;
    this.lastPublishAt = 0;
    console.log(`[RAIN-GPIO] 감시 시작 — chip=${this.chip} BCM${this.pin} activeLow=${this.activeLow} → z2m/${this.friendlyName}`);
    this.timer = setInterval(() => this._tick(), POLL_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _tick() {
    this._readLevel((level) => {
      if (level === null) return; // 읽기 실패 — 스킵
      // activeLow: 물리 LOW(0) = 비 감지
      const rain = this.activeLow ? level === 0 : level === 1;

      // 디바운스: 연속 STABLE_SAMPLES회 동일해야 확정
      if (this.pending === rain) {
        this.pendingCount++;
      } else {
        this.pending = rain;
        this.pendingCount = 1;
      }

      const now = Date.now();
      const confirmed = this.pendingCount >= STABLE_SAMPLES;

      if (confirmed && this.state !== rain) {
        this.state = rain;
        this._publish(rain);
        console.log(`[RAIN-GPIO] 상태 변화 → ${rain ? 'RAIN(비)' : 'DRY(맑음)'}`);
      } else if (this.state !== null && now - this.lastPublishAt >= REPUBLISH_MS) {
        // 변화 없어도 주기 재발행 (백엔드 late-join 대비)
        this._publish(this.state);
      }
    });
  }

  _readLevel(cb) {
    // libgpiod v2: gpioget -c <chip> --bias pull-up <pin> (gpio-agent 의 gpioset 인자 형식과 동일)
    execFile('gpioget', ['-c', this.chip, '--bias', 'pull-up', String(this.pin)], { timeout: 800 }, (err, stdout) => {
      if (err) {
        const now = Date.now();
        if (now - this.errorLoggedAt > 30000) { // 로그 스팸 방지 (30초 throttle)
          this.errorLoggedAt = now;
          console.error(`[RAIN-GPIO] gpioget 실패 (BCM${this.pin}): ${err.message}`);
        }
        return cb(null);
      }
      const out = String(stdout).trim().toLowerCase();
      let level = null;
      if (out.includes('inactive')) level = 0;
      else if (out.includes('active')) level = 1;
      else if (/(^|\D)0(\D|$)/.test(out)) level = 0;
      else if (/(^|\D)1(\D|$)/.test(out)) level = 1;
      cb(level);
    });
  }

  _publish(rain) {
    if (!this.client || !this.client.connected) return;
    const topic = `farm/${this.gatewayId}/z2m/${this.friendlyName}`;
    this.client.publish(topic, JSON.stringify({ rain: !!rain }), { qos: 1 });
    this.lastPublishAt = Date.now();
  }
}

module.exports = RainGpio;
