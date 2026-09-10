/**
 * verify-rbac-endpoints.ts — RBAC 경계 + 푸시 + 터널상태 + rain-override + config-deploy 접근
 *
 * 커버:
 *  [#5] RBAC: farm_user 가 admin/denyFarmUser 백엔드 엔드포인트에서 403
 *  [#12] 네이티브 푸시: device-token 등록/삭제, /notifications/test configured 응답
 *  [#16] 게이트웨이 터널 상태: GET /gateways 의 agentStatus/tunnelPort 필드
 *  [#4] rain-override: PATCH /devices/:id/rain-override-disabled 토글→복원
 *  [#10] config-deploy: template(admin 200 / farm_user 403)
 *
 * 계정: admin/Sessadojs3535!@, (farm_admin) mtest/admin123, (farm_user) user1/admin123 — 없으면 SKIP
 */
const API = 'http://localhost:3100/api';
async function req(method: string, path: string, tok?: string, body?: any) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data: any = null; try { data = await r.json(); } catch {}
  return { st: r.status, data };
}
const arr = (d: any) => (Array.isArray(d) ? d : d?.data ?? []);
const results: any[] = [];
const rec = (n: string, s: string, m = '') => results.push({ n, s, m });
async function tokenOf(u: string, p: string): Promise<string> {
  return (await req('POST', '/auth/login', undefined, { username: u, password: p })).data?.accessToken ?? '';
}

(async () => {
  const admin = await tokenOf('admin', 'Sessadojs3535!@');
  if (!admin) { rec('admin login', 'FAIL'); return finish(); }
  const farmUser = await tokenOf('user1', 'admin123');
  const farmAdmin = await tokenOf('mtest', 'admin123');

  // ── [#5] RBAC ──
  const uAdmin = await req('GET', '/users', admin);
  rec('[#5] admin → /users 200', uAdmin.st === 200 ? 'PASS' : 'FAIL', `HTTP ${uAdmin.st}`);
  if (farmUser) {
    const cases: [string, string, string, any?][] = [
      ['GET', '/users', 'admin전용'],
      ['GET', '/config-deploy/template', 'admin전용'],
    ];
    for (const [m, path, label] of cases) {
      const r = await req(m, path, farmUser);
      rec(`[#5] farm_user → ${path} 차단(${label})`, r.st === 403 ? 'PASS' : 'WARN', `HTTP ${r.st} (403 기대)`);
    }
    // gateway-manager write (admin/farm_admin) — farm_user POST 차단
    const gwPost = await req('POST', '/gateways', farmUser, { gatewayId: 'e2e-forbidden', name: 'x' });
    rec('[#5] farm_user → POST /gateways 차단', gwPost.st === 403 ? 'PASS' : 'WARN', `HTTP ${gwPost.st}`);
  } else rec('[#5] farm_user RBAC', 'SKIP', 'user1 계정 없음');
  if (farmAdmin) {
    const r = await req('GET', '/users', farmAdmin);
    rec('[#5] farm_admin → /users 차단(admin전용)', r.st === 403 ? 'PASS' : 'WARN', `HTTP ${r.st}`);
  } else rec('[#5] farm_admin RBAC', 'SKIP', 'mtest 계정 없음');

  // ── [#10] config-deploy 접근 ──
  const tpl = await req('GET', '/config-deploy/template', admin);
  rec('[#10] admin → config-deploy/template 200', tpl.st === 200 ? 'PASS' : 'WARN', `HTTP ${tpl.st}`);

  // ── [#16] 게이트웨이 터널/agent 상태 필드 ──
  const gws = arr((await req('GET', '/gateways', admin)).data);
  if (gws.length) {
    const g = gws[0];
    const hasFields = ('agentStatus' in g) || ('agent_status' in g) || ('tunnelPort' in g) || ('tunnel_port' in g);
    rec('[#16] 게이트웨이 agentStatus/tunnelPort 필드', hasFields ? 'PASS' : 'WARN', `keys=${Object.keys(g).filter(k=>/agent|tunnel|status|online/i.test(k)).join(',')}`);
  } else rec('[#16] 게이트웨이', 'SKIP', '게이트웨이 없음');

  // ── [#12] 네이티브 푸시 ──
  const TT = 'E2E-PUSH-' + Math.floor(Date.now() / 1000);
  const reg = await req('POST', '/notifications/device-token', admin, { token: TT, platform: 'android' });
  rec('[#12] device-token 등록', reg.st === 201 || reg.st === 200 ? 'PASS' : 'FAIL', `HTTP ${reg.st} ${JSON.stringify(reg.data)}`);
  const test = await req('POST', '/notifications/test', admin);
  const okTest = (test.st === 201 || test.st === 200) && ('configured' in (test.data ?? {}));
  rec('[#12] /notifications/test 무크래시(configured)', okTest ? 'PASS' : 'WARN', `HTTP ${test.st}, configured=${test.data?.configured}`);
  const unreg = await req('DELETE', '/notifications/device-token', admin, { token: TT });
  rec('[#12] device-token 삭제(정리)', unreg.st === 200 || unreg.st === 201 ? 'PASS' : 'WARN', `HTTP ${unreg.st}`);

  // ── [#4] rain-override 토글 ──
  const devices = arr((await req('GET', '/devices', admin)).data);
  const rainSensor = devices.find((d: any) => /우적|rain/i.test(d.name ?? '') || d.zigbeeModel === 'TS0207');
  if (rainSensor) {
    const orig = !!rainSensor.rainOverrideDisabled;
    const p = await req('PATCH', `/devices/${rainSensor.id}/rain-override-disabled`, admin, { disabled: !orig });
    const after = arr((await req('GET', '/devices', admin)).data).find((d: any) => d.id === rainSensor.id);
    rec('[#4] rain-override 토글 반영', p.st === 200 && !!after?.rainOverrideDisabled === !orig ? 'PASS' : 'WARN', `HTTP ${p.st}, 반영=${after?.rainOverrideDisabled}`);
    await req('PATCH', `/devices/${rainSensor.id}/rain-override-disabled`, admin, { disabled: orig }); // 복원
  } else rec('[#4] rain-override', 'SKIP', '우적센서 없음');

  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.s === s).length;
  for (const r of results) console.log(`${r.s === 'PASS' ? '✓' : r.s === 'FAIL' ? '✗' : r.s === 'SKIP' ? '·' : '⚠'} ${r.n}${r.m ? ' — ' + r.m : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')} | SKIP: ${c('SKIP')}`);
}
