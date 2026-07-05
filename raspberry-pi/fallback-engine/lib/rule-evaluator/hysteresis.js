'use strict';

/**
 * 공용 히스테리시스 판정 (유동팬·개폐기 재사용).
 *
 * on=활성(가동/개방) 임계, off=비활성(정지/닫힘) 임계, on > off 를 전제로 한다.
 * - 현재 비활성(off): 측정값 > onValue 이면 활성(true)
 * - 현재 활성(on):   측정값 < offValue 이면 비활성(false), 그 외 유지(true)
 *
 * 기존 fan.js 의 판정 로직과 100% 동일 (동작 불변, 중복 제거 목적).
 *
 * @param {boolean} currentlyOn 현재 활성 상태
 * @param {number} reading 측정값 (°C 또는 %)
 * @param {number} onValue 활성 임계
 * @param {number} offValue 비활성 임계
 * @returns {boolean} 목표 활성 여부
 */
function evaluateHysteresis(currentlyOn, reading, onValue, offValue) {
  if (currentlyOn) {
    return reading < offValue ? false : true;
  }
  return reading > onValue ? true : false;
}

module.exports = { evaluateHysteresis };
