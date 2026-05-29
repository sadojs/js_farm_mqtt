'use strict';

/**
 * Pi 측 apply-*.sh 스크립트 실행 헬퍼.
 * stdout 1줄을 JSON으로 파싱하여 반환 (실패 시 status='failed').
 */

const { execFile } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = process.env.SMARTFARM_SCRIPTS_DIR || '/opt/smart-farm/scripts';

/**
 * @param {string} scriptName - apply-wifi.sh 등 파일명
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<object>} 스크립트가 출력한 JSON
 */
function runScript(scriptName, args, timeoutMs = 120_000) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return new Promise((resolve) => {
    execFile('bash', [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      if (!out) {
        resolve({
          ok: false,
          status: 'failed',
          detail: err
            ? `${scriptName} exec error: ${err.message}`
            : `${scriptName} no output (stderr: ${String(stderr || '').slice(0, 200)})`,
        });
        return;
      }
      // stdout 마지막 줄만 JSON으로 파싱
      const lastLine = out.split('\n').pop() || out;
      try {
        const parsed = JSON.parse(lastLine);
        resolve(parsed);
      } catch (parseErr) {
        resolve({
          ok: false,
          status: 'failed',
          detail: `${scriptName} JSON parse failed: ${parseErr.message}; raw: ${lastLine.slice(0, 200)}`,
        });
      }
    });
  });
}

module.exports = { runScript };
