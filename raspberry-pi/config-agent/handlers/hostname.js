'use strict';

const { runScript } = require('./exec-script');

async function handleHostname(request) {
  const hostname = request && request.hostname;
  if (!hostname) {
    return { ok: false, status: 'failed', detail: 'hostname 누락' };
  }
  return runScript('apply-hostname.sh', [hostname], 20_000);
}

module.exports = { handleHostname };
