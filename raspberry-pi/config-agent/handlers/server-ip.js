'use strict';

const { runScript } = require('./exec-script');
const { execSync } = require('child_process');

async function handleServerIp(request) {
  const newIp = request && request.serverIp;
  if (!newIp) {
    return { ok: false, status: 'failed', detail: 'serverIp 누락' };
  }
  // 선택: 새 서버용 bootstrap 토큰 (서버 전환 시 재등록에 필요). 없으면 기존 토큰 유지.
  const newToken = (request && request.bootstrapToken) || '';
  // 선택: 새 망 WiFi (HQ/개발망 → 농장/프로덕션망 전환 시 함께 변경)
  const ssid = (request && (request.ssid || (request.wifi && request.wifi.ssid))) || '';
  const psk = (request && (request.psk || (request.wifi && request.wifi.password))) || '';
  // apply-server-ip.sh 는 위치 인자: <ip> [token] [ssid] [psk]
  const args = [newIp];
  if (newToken || ssid) args.push(newToken); // ssid 를 넘기려면 token 자리(빈 문자열이라도) 필요
  if (ssid) args.push(ssid, psk);
  const result = await runScript('apply-server-ip.sh', args, 150_000);
  // 응답 전송 후 config-agent 자신을 재시작 (새 MQTT_SERVER로 재연결)
  if (result && result.ok) {
    setTimeout(() => {
      try {
        execSync('systemctl restart config-agent', { timeout: 10_000 });
      } catch (e) {
        // ignore
      }
    }, 1500);
  }
  return result;
}

module.exports = { handleServerIp };
