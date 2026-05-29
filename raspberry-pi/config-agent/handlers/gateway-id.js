'use strict';

const { runScript } = require('./exec-script');
const { execSync } = require('child_process');

async function handleGatewayId(request) {
  const newId = request && request.gatewayId;
  if (!newId) {
    return { ok: false, status: 'failed', detail: 'gatewayId 누락' };
  }
  const result = await runScript('apply-gateway-id.sh', [newId], 60_000);
  // 응답 전송 후 config-agent 자신을 재시작하도록 예약 (현재 PID는 새 GATEWAY_ID로 재구독 필요)
  if (result && result.ok) {
    setTimeout(() => {
      try {
        execSync('systemctl restart config-agent', { timeout: 10_000 });
      } catch (e) {
        // ignore — main process exit handler picks it up
      }
    }, 1500);
  }
  return result;
}

module.exports = { handleGatewayId };
