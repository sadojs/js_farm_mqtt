'use strict';

/**
 * 온습도계(측정값) 신선도 감시.
 *
 * 폴백 모드에서 개폐기 온습도 제어(primary)를 쓸지, 시간 스케줄(backup)로 내려갈지
 * 결정하기 위해 "온습도계가 살아 있는가"를 판정한다.
 *
 * - isFresh(): 해당 트리거(온도/습도)의 마지막 수신 시각이 timeout 이내면 true.
 * - neverReceivedInGrace(): 부팅 직후 아직 한 번도 못 받았고 grace 이내면 true
 *   (부팅 직후 성급하게 backup 으로 내려가는 것을 막는다 — heartbeat-watchdog 과 동일 취지).
 *
 * state.lastTemperatureAt / lastHumidityAt 는 RuleEvaluator.ingestSensor() 가 기록한다(ms epoch).
 */

const SENSOR_COLD_BOOT_GRACE_MS = 60_000;

class SensorWatchdog {
  constructor(bootAt = Date.now()) {
    this.bootedAt = bootAt;
  }

  /** 해당 트리거의 최근 측정값이 유효(fresh)한가 */
  isFresh(triggerType, state, timeoutMs, now = Date.now()) {
    const at = triggerType === 'humidity' ? state.lastHumidityAt : state.lastTemperatureAt;
    const reading = triggerType === 'humidity' ? state.lastHumidity : state.lastTemperature;
    if (typeof reading !== 'number' || !at) return false;
    return now - at <= timeoutMs;
  }

  /** 아직 첫 수신 전 + 부팅 grace 이내 (backup 전환 유예) */
  neverReceivedInGrace(triggerType, state, now = Date.now()) {
    const at = triggerType === 'humidity' ? state.lastHumidityAt : state.lastTemperatureAt;
    return !at && now - this.bootedAt < SENSOR_COLD_BOOT_GRACE_MS;
  }
}

module.exports = { SensorWatchdog, SENSOR_COLD_BOOT_GRACE_MS };
