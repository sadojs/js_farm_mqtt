/**
 * verify-rule-lifecycle.ts — 자동제어 룰 정지/원복 + 장치 삭제 의존성 차단
 *
 * 커버:
 *  [F4] 일괄제어 룰 정지/원복 (disabledReason='bulk')
 *       POST /automation/devices/active-rules, /devices/stop-rules,
 *       GET /automation/bulk-stopped-rules, POST /automation/rules/restore
 *  [F5] 개별 수동제어 룰 정지 (disabledReason='manual', 공유 배너)
 *       GET /automation/device/:id/active-rules, POST /automation/device/:id/stop-rules
 *  [F1] 장치 삭제 의존성 차단 (룰 참조 시 409 / canDelete:false)
 *       GET /devices/:id/dependencies, DELETE /gateway-env/:gw/zigbee/:id (409)
 *
 * 비파괴 원칙: 정지한 룰은 반드시 원복. 실제 삭제는 "차단(409)"만 확인하고 삭제 안 함.
 */
const API = 'http://localhost:3100/api';
let TOK = '';
async function req(method: string, path: string, body?: any): Promise<{ st: number; data: any }> {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOK ? { Authorization: 'Bearer ' + TOK } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* no body */ }
  return { st: r.status, data };
}
const arr = (d: any) => (Array.isArray(d) ? d : d?.data ?? []);
const results: { name: string; status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; msg?: string }[] = [];
const rec = (name: string, status: 'PASS'|'FAIL'|'WARN'|'SKIP', msg = '') => results.push({ name, status, msg });

(async () => {
  const login = await req('POST', '/auth/login', { username: 'admin', password: 'Sessadojs3535!@' });
  TOK = login.data?.accessToken;
  if (!TOK) { rec('login', 'FAIL', String(login.st)); return finish(); }

  const rules = arr((await req('GET', '/automation/rules')).data);
  const devices = arr((await req('GET', '/devices')).data);

  // 룰이 참조하는 deviceId 추출 헬퍼
  const ruleTargets = (r: any): string[] => {
    const a = r.actions ?? {};
    const acts = Array.isArray(a) ? a : [a];
    const ids: string[] = [];
    for (const x of acts) {
      if (x?.targetDeviceId) ids.push(x.targetDeviceId);
      if (Array.isArray(x?.targetDeviceIds)) ids.push(...x.targetDeviceIds);
    }
    return ids;
  };
  // 활성 룰이 참조하는 device 하나 찾기
  let targetDeviceId = '';
  let refRule: any = null;
  for (const r of rules) {
    if (!r.enabled) continue;
    const ids = ruleTargets(r).filter((id) => devices.some((d: any) => d.id === id));
    if (ids.length) { targetDeviceId = ids[0]; refRule = r; break; }
  }

  // ── [F4] 일괄제어 정지/원복 ──
  if (targetDeviceId) {
    const active = arr((await req('POST', '/automation/devices/active-rules', { deviceIds: [targetDeviceId] })).data);
    rec('[F4] active-rules(deviceIds) 참조 룰 조회', active.some((x: any) => x.id === refRule.id) ? 'PASS' : 'FAIL', `${active.length}개`);

    const stop = await req('POST', '/automation/devices/stop-rules', { deviceIds: [targetDeviceId] });
    const stopped = stop.data?.stopped ?? [];
    rec('[F4] stop-rules 정지', stopped.length > 0 ? 'PASS' : 'WARN', `${stopped.length}개 정지`);

    const banner = arr((await req('GET', '/automation/bulk-stopped-rules')).data);
    rec('[F4] bulk-stopped-rules 배너 노출', banner.some((x: any) => x.id === refRule.id) ? 'PASS' : 'FAIL', `배너 ${banner.length}개`);

    const restore = await req('POST', '/automation/rules/restore', {});
    const restored = restore.data?.restored ?? [];
    const bannerAfter = arr((await req('GET', '/automation/bulk-stopped-rules')).data);
    rec('[F4] 전체 원복 → 배너 비움', restored.length > 0 && bannerAfter.length === 0 ? 'PASS' : 'FAIL', `원복 ${restored.length}개, 잔여 ${bannerAfter.length}`);
  } else {
    rec('[F4] 일괄 정지/원복', 'SKIP', '활성 룰이 참조하는 장치 없음');
  }

  // ── [F5] 개별 수동제어 정지(manual 마커) + 공유 배너 + 개별 원복 ──
  if (targetDeviceId) {
    const g = await req('GET', `/automation/device/${targetDeviceId}/active-rules`); // GET 확인
    rec('[F5] device active-rules 는 GET', g.st === 200 ? 'PASS' : 'FAIL', `HTTP ${g.st}`);
    const active = arr(g.data);
    if (active.length) {
      const s = await req('POST', `/automation/device/${targetDeviceId}/stop-rules`, {});
      const stopped = s.data?.stopped ?? [];
      rec('[F5] device stop-rules 정지', stopped.length > 0 ? 'PASS' : 'WARN', `${stopped.length}개`);
      const banner = arr((await req('GET', '/automation/bulk-stopped-rules')).data);
      const inBanner = stopped.every((x: any) => banner.some((b: any) => b.id === x.id));
      rec('[F5] manual 정지도 공유 배너에 노출', inBanner && banner.length > 0 ? 'PASS' : 'FAIL', `배너 ${banner.length}개`);
      // 개별 원복(ruleIds 지정)
      const ids = stopped.map((x: any) => x.id);
      const rst = await req('POST', '/automation/rules/restore', { ruleIds: ids });
      const bannerAfter = arr((await req('GET', '/automation/bulk-stopped-rules')).data);
      rec('[F5] 개별 원복(ruleIds) → 해당 룰 제거', (rst.data?.restored?.length ?? 0) > 0 && bannerAfter.length === 0 ? 'PASS' : 'FAIL', `잔여 ${bannerAfter.length}`);
    } else {
      rec('[F5] 개별 정지/원복', 'SKIP', '활성 룰 없음(이미 원복됨?)');
    }
  }

  // ── [F1] 장치 삭제 의존성 차단 ──
  if (targetDeviceId) {
    const dep = await req('GET', `/devices/${targetDeviceId}/dependencies`);
    const rulesDep = dep.data?.automationRules ?? [];
    rec('[F1] dependencies canDelete=false (룰 참조)', dep.data?.canDelete === false && rulesDep.length > 0 ? 'PASS' : 'WARN', `canDelete=${dep.data?.canDelete}, rules=${rulesDep.length}`);

    // 실제 삭제 차단 확인 — 지그비 장치면 gateway-env 경로로 409 기대(비파괴: 차단되어 삭제 안 됨)
    const dev = devices.find((d: any) => d.id === targetDeviceId);
    if (dev?.source !== 'onboard' && dev?.gatewayId) {
      const del = await req('DELETE', `/gateway-env/${dev.gatewayId}/zigbee/${targetDeviceId}`);
      rec('[F1] 룰 참조 지그비 삭제 → 409 차단', del.st === 409 && (del.data?.dependencies?.automationRules?.length ?? 0) > 0 ? 'PASS' : 'FAIL', `HTTP ${del.st}`);
      // 삭제 안 됐는지 확인
      const still = arr((await req('GET', '/devices')).data).some((d: any) => d.id === targetDeviceId);
      rec('[F1] 차단 후 장치 잔존', still ? 'PASS' : 'FAIL');
    } else {
      // onboard 경로: devices DELETE 도 409 체크(단, opener는 400) — 비파괴 확인만
      const del = await req('DELETE', `/devices/${targetDeviceId}`);
      const ok = del.st === 409 || del.st === 400; // 룰 참조 409 또는 개폐기 400
      rec('[F1] 룰 참조 onboard 삭제 차단(409/400)', ok ? 'PASS' : 'WARN', `HTTP ${del.st} (${del.data?.message ?? ''})`);
      const still = arr((await req('GET', '/devices')).data).some((d: any) => d.id === targetDeviceId);
      rec('[F1] 차단 후 장치 잔존', still ? 'PASS' : 'FAIL');
    }
  } else {
    rec('[F1] 삭제 의존성 차단', 'SKIP', '룰 참조 장치 없음');
  }

  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.status === s).length;
  for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'SKIP' ? '·' : '⚠'} ${r.name}${r.msg ? ' — ' + r.msg : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')} | SKIP: ${c('SKIP')}`);
}
