'use strict';

/**
 * 빗물 센서 상태 추적.
 * - z2m 센서 메시지에서 'rain' 또는 'water_leak' 키를 보고 active/inactive 판정
 * - 변화가 있을 때만 'active' 또는 'inactive' 반환
 * - 변화 없으면 null 반환 (호출자가 no-op 처리)
 */

class RainOverride {
  constructor() {
    this.current = 'inactive';
    this.lastEmitted = null;
  }

  ingestSensor(deviceName, data) {
    if (!data || typeof data !== 'object') return;

    // 흔한 키: rain (Tuya), water_leak (Aqara), rain_detected
    let detected = null;
    if (typeof data.rain === 'boolean') detected = data.rain;
    else if (typeof data.water_leak === 'boolean') detected = data.water_leak;
    else if (typeof data.rain_detected === 'boolean') detected = data.rain_detected;

    if (detected === null) return;

    this.current = detected ? 'active' : 'inactive';
  }

  /**
   * @returns 'active' | 'inactive' | null (변화 없음)
   */
  state() {
    if (this.lastEmitted === this.current) return null;
    this.lastEmitted = this.current;
    return this.current;
  }
}

module.exports = RainOverride;
