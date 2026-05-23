'use strict';

const { runScript } = require('./exec-script');

/**
 * rpi-hostname-gateway-id-unify
 * identity_update action 핸들러 — hostname + gateway-id 통합 변경.
 * apply-identity.sh가 apply-hostname + apply-gateway-id를 순차 실행.
 * 서비스 재시작 시간 + hostname 처리 시간 고려해 40초 timeout.
 */
async function handleIdentity(request) {
  const name = request && request.name;
  if (!name) {
    return { ok: false, status: 'failed', detail: 'name 누락' };
  }
  return runScript('apply-identity.sh', [name], 40_000);
}

module.exports = { handleIdentity };
