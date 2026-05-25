'use strict';

const { runScript } = require('./exec-script');

/**
 * rpi-agent-version-update
 * agent_update action 핸들러 — Pi의 agent 코드를 backend의 archive로 update.
 *
 * Phase 1 한정: fallback-engine, gpio-agent 권장.
 * config-agent self-update는 응답 전송 중 systemctl restart로 끊김 위험 (Phase 2에서 launcher 패턴 도입).
 *
 * timeout 180s — npm install + restart + 검증.
 */
async function handleAgentUpdate(request) {
  const agent = request && request.agent;
  if (!['config-agent', 'gpio-agent', 'fallback-engine'].includes(agent)) {
    return { ok: false, status: 'failed', detail: `invalid agent: ${agent}` };
  }
  return runScript('apply-agent-update.sh', [agent], 180_000);
}

module.exports = { handleAgentUpdate };
