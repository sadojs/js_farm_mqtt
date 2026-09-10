/**
 * verify-device-replace.ts — 지그비 장치 교체 (동일 기종 필터 + 룰/매핑 보존)
 *
 * 커버 (F2):
 *  GET  /devices/:id/replace-preview  — impact(rulesCount/mappingKeys/paired) + compatibility(requireModel 등)
 *  POST /devices/:id/replace          — 비호환 모델 → 400 {error:'incompatible'}
 *  (전체 교체는 실제 페어링 필요 → preview + 비호환 거부만 자동 검증. 보존 로직은 devices.id 불변 설계)
 *
 * 비파괴: 실제 replace 는 "비호환 거부(400)"만 시도. 정상 교체는 수동/하드웨어 필요(문서화).
 */
const API = 'http://localhost:3100/api';
async function req(method: string, path: string, tok?: string, body?: any) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data: any = null; try { data = await r.json(); } catch {}
  return { st: r.status, data };
}
const arr = (d: any) => (Array.isArray(d) ? d : d?.data ?? []);
const results: any[] = [];
const rec = (name: string, status: string, msg = '') => results.push({ name, status, msg });

(async () => {
  const tok = (await req('POST', '/auth/login', undefined, { username: 'admin', password: 'Sessadojs3535!@' })).data?.accessToken;
  if (!tok) { rec('login', 'FAIL'); return finish(); }

  const devices = arr((await req('GET', '/devices', tok)).data);
  // 지그비 장치(교체 대상) — source !== 'onboard' 이고 zigbeeIeee/zigbeeModel 있음
  const zdev = devices.find((d: any) => d.source !== 'onboard' && (d.zigbeeModel || d.zigbeeIeee));
  if (!zdev) { rec('[F2] 지그비 장치', 'SKIP', '이 환경에 지그비 장치 없음(onboard 위주)'); return finish(); }

  // preview
  const pv = await req('GET', `/devices/${zdev.id}/replace-preview`, tok);
  rec('[F2] replace-preview 조회', pv.st === 200 ? 'PASS' : 'FAIL', `HTTP ${pv.st}`);
  const impact = pv.data?.impact ?? {};
  const compat = pv.data?.compatibility ?? {};
  rec('[F2] preview.impact 구조(rulesCount/mappingKeys)', ('rulesCount' in impact) ? 'PASS' : 'WARN', `rules=${impact.rulesCount}, mapKeys=${(impact.mappingKeys||[]).length}, paired=${impact.pairedDeviceName ?? '-'}`);
  rec('[F2] preview.compatibility.requireModel(동일기종)', compat.requireModel ? 'PASS' : 'WARN', `requireModel=${compat.requireModel}, chCount=${compat.requireChannelCount}`);

  // 비호환 모델로 replace 시도 → 400 incompatible
  const bad = await req('POST', `/devices/${zdev.id}/replace`, tok, {
    newIeee: '0x0000000000000000',
    newFriendlyName: 'E2E_INCOMPAT_TEST',
    newZigbeeModel: 'TOTALLY_DIFFERENT_MODEL_XYZ',
    newChannelCount: 1,
  });
  const errStr = typeof bad.data?.error === 'string' ? bad.data.error : (bad.data?.error?.error ?? JSON.stringify(bad.data?.error ?? bad.data?.message ?? ''));
  rec('[F2] 비호환 모델 replace → 400 거부(동일기종 필터)', bad.st === 400 ? 'PASS' : 'FAIL', `HTTP ${bad.st}, ${errStr}`);

  // 원 장치 그대로인지(비파괴)
  const still = arr((await req('GET', '/devices', tok)).data).find((d: any) => d.id === zdev.id);
  rec('[F2] 거부 후 원 장치 IEEE 불변', still && still.zigbeeIeee === zdev.zigbeeIeee ? 'PASS' : 'WARN', `ieee=${still?.zigbeeIeee}`);

  rec('[F2] 정상 교체(보존) 자동검증', 'SKIP', '실제 페어링/스캔 필요 — 수동 검증. devices.id 불변 설계로 룰/매핑/페어 자동 승계');

  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.status === s).length;
  for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'SKIP' ? '·' : '⚠'} ${r.name}${r.msg ? ' — ' + r.msg : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')} | SKIP: ${c('SKIP')}`);
}
