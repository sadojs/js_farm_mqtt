// raspberry-pi/config-agent/handlers/service-restart.js
// Pi systemd 서비스 안전 재시작 (config-agent는 root로 실행되어 sudo 불필요)

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// 허용 서비스 allowlist (보안 — 임의 service 차단)
const ALLOWED = new Set([
  'gpio-agent', 'zigbee2mqtt', 'fallback-engine', 'reverse-ssh-tunnel',
  // 'config-agent' — 자기 자신 재시작은 race 위험으로 제외
]);

async function handleServiceRestart(request) {
  const service = String(request.service || '').trim();
  if (!ALLOWED.has(service)) {
    return {
      ok: false,
      status: 'failed',
      detail: `허용되지 않은 서비스: ${service}. 가능: ${[...ALLOWED].join(', ')}`,
    };
  }

  try {
    await execAsync(`systemctl restart ${service}`, { timeout: 15000 });
    // restart 후 활성 여부 확인 — 일부 service는 restart 직후 활성화에 1~2초 소요
    await new Promise((r) => setTimeout(r, 1500));
    const { stdout } = await execAsync(`systemctl is-active ${service}`, { timeout: 5000 }).catch(
      (e) => ({ stdout: (e.stdout || '').toString().trim() }),
    );
    const active = stdout.trim() === 'active';
    return {
      ok: active,
      status: active ? 'success' : 'failed',
      detail: active ? `${service} restarted (active)` : `${service} restart 후 active 아님 (${stdout.trim()})`,
      service,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      detail: `systemctl restart ${service} 실패: ${err.message}`,
      service,
    };
  }
}

module.exports = { handleServiceRestart };
