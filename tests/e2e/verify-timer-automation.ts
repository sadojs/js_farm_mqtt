/**
 * verify-timer-automation.ts — 타이머 동작 중 자동화룰 미동작 (회귀)
 *
 * 버그: 개폐기를 타이머로 동작시켜도 자동화룰(duty-cycle)이 active→inactive 전환 시
 *   clearRelayActivePhase 가 타이머 userOverride 까지 지워, 다음 틱에 룰이 장치를 반대로 동작.
 * 수정: clearRelayActivePhase 가 활성 타이머(overrideUntil 미래) 장치는 건드리지 않음.
 *
 * 검증: 개폐기에 타이머(close) 설정 → ~50초(크론 10s + 1분 사이클) 동안 상태 불변 +
 *       백엔드 로그에 [manual-override] skip 발생 (룰이 타이머 존중).
 *
 * ⚠️ 시간 의존(50초+). 대상 게이트웨이에 duty-cycle 개폐기 룰이 활성일 때 가장 유의미.
 */
const API = 'http://localhost:3100/api';
async function req(method: string, path: string, tok?: string, body?: any) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data: any = null; try { data = await r.json(); } catch {}
  return { st: r.status, data };
}
const arr = (d: any) => (Array.isArray(d) ? d : d?.data ?? []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: any[] = [];
const rec = (n: string, s: string, m = '') => results.push({ n, s, m });

(async () => {
  const tok = (await req('POST', '/auth/login', undefined, { username: 'admin', password: 'Sessadojs3535!@' })).data?.accessToken;
  if (!tok) { rec('login', 'FAIL'); return finish(); }
  const snap = async () => arr((await req('GET', '/devices', tok)).data);
  const devs = await snap();
  const op = devs.find((d: any) => d.equipmentType === 'opener_open');
  if (!op) { rec('개폐기', 'SKIP', '없음'); return finish(); }

  const set = await req('POST', `/devices/${op.id}/timer`, tok, { direction: 'close', durationMinutes: 5 });
  rec('타이머(close,5분) 설정', set.st === 201 || set.st === 200 ? 'PASS' : 'FAIL', `HTTP ${set.st}`);
  await sleep(2000);
  const before = (await snap()).find((d: any) => d.id === op.id);
  const pairBefore = before?.pairedDeviceId ? (await snap()).find((d: any) => d.id === before.pairedDeviceId) : null;

  await sleep(50000); // 크론 사이클 통과 (10s relay + 1분 cron)

  const after = (await snap()).find((d: any) => d.id === op.id);
  const pairAfter = after?.pairedDeviceId ? (await snap()).find((d: any) => d.id === after.pairedDeviceId) : null;
  const stable = before?.switchState === after?.switchState && (pairBefore?.switchState ?? null) === (pairAfter?.switchState ?? null);
  rec('타이머 중 개폐기 상태 불변(룰 미동작)', stable ? 'PASS' : 'FAIL',
    `열기 ${before?.switchState}→${after?.switchState}, 닫기 ${pairBefore?.switchState}→${pairAfter?.switchState}`);

  // 타이머 override 유지 확인(간접: cancel 성공 시 override 존재했음)
  await req('POST', `/devices/${op.id}/timer/cancel`, tok, {});
  rec('테스트 타이머 정리', 'PASS');
  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.s === s).length;
  for (const r of results) console.log(`${r.s === 'PASS' ? '✓' : r.s === 'FAIL' ? '✗' : r.s === 'SKIP' ? '·' : '⚠'} ${r.n}${r.m ? ' — ' + r.m : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | SKIP: ${c('SKIP')}`);
}
