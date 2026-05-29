'use strict';

const { runScript } = require('./exec-script');

/**
 * Wi-Fi 변경 핸들러.
 * 입력: request.wifi = { ssid, password }
 * 출력: ConfigResponse 필드 일부 (status / detail / pingResult)
 */
async function handleWifi(request) {
  const wifi = request && request.wifi;
  if (!wifi || !wifi.ssid || !wifi.password) {
    return { ok: false, status: 'failed', detail: 'wifi.ssid / wifi.password 누락' };
  }
  // 90초 timeout (script 내부도 60초 ping + 마진)
  return runScript('apply-wifi.sh', [wifi.ssid, wifi.password], 90_000);
}

module.exports = { handleWifi };
