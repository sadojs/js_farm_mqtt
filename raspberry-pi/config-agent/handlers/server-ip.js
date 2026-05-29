'use strict';

const { runScript } = require('./exec-script');
const { execSync } = require('child_process');

async function handleServerIp(request) {
  const newIp = request && request.serverIp;
  if (!newIp) {
    return { ok: false, status: 'failed', detail: 'serverIp 누락' };
  }
  const result = await runScript('apply-server-ip.sh', [newIp], 120_000);
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
