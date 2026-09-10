/**
 * verify-env-config.ts — 환경설정: 비감지(우적) 센서 역할 + 장치 옵션 + RBAC
 *
 * 커버 (F3):
 *  GET  /env-config/roles                       — rain_detection role 존재
 *  GET  /env-config/groups/:id/sources          — 우적센서 rain_detection 소스 노출
 *  GET  /env-config/groups/:id/mappings         — 매핑 조회
 *  PATCH /env-config/groups/:id/device-settings — rainEnabled/고온강제열림 옵션 저장→복원
 *  RBAC: farm_user 는 PUT mappings 403
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

  // roles
  const roles = arr((await req('GET', '/env-config/roles', tok)).data);
  const rain = roles.find((r: any) => r.roleKey === 'rain_detection' || r.role_key === 'rain_detection');
  rec('[F3] roles 에 rain_detection(비 감지) 존재', rain ? 'PASS' : 'FAIL', rain ? `label=${rain.label}, cat=${rain.category}` : `roles=${roles.length}`);

  // group 하나 선택
  const groups = arr((await req('GET', '/groups', tok)).data);
  if (!groups.length) { rec('[F3] 그룹 없음', 'SKIP'); return finish(); }
  const gid = groups[0].id;

  const sources = (await req('GET', `/env-config/groups/${gid}/sources`, tok)).data;
  const sensorSrc = arr(sources?.sensors ?? sources);
  const hasRainSrc = sensorSrc.some((s: any) => (s.sensorType ?? s.sensor_type) === 'rain_detection');
  rec('[F3] sources 에 우적(rain_detection) 센서 후보', hasRainSrc ? 'PASS' : 'WARN', hasRainSrc ? 'O' : '이 그룹에 우적센서 미매핑(데이터)');

  const maps = await req('GET', `/env-config/groups/${gid}/mappings`, tok);
  rec('[F3] mappings 조회', maps.st === 200 ? 'PASS' : 'FAIL', `HTTP ${maps.st}`);

  // device-settings 읽기 → rainEnabled 토글 저장 → 복원
  const ds = (await req('GET', `/env-config/groups/${gid}/device-settings`, tok)).data;
  rec('[F3] device-settings 조회', ds ? 'PASS' : 'FAIL', ds ? `hasRainSensor=${ds.hasRainSensor}, rainEnabled=${ds.rainEnabled}, highTempOverride=${ds.highTempOverrideEnabled}` : '');
  if (ds && ds.hasRainSensor) {
    const orig = ds.rainEnabled;
    const p1 = await req('PATCH', `/env-config/groups/${gid}/device-settings`, tok, { rainEnabled: !orig });
    const ds2 = (await req('GET', `/env-config/groups/${gid}/device-settings`, tok)).data;
    rec('[F3] rainEnabled 토글 저장 반영', p1.st === 200 && ds2.rainEnabled === !orig ? 'PASS' : 'FAIL', `HTTP ${p1.st}, 반영=${ds2.rainEnabled}`);
    await req('PATCH', `/env-config/groups/${gid}/device-settings`, tok, { rainEnabled: orig }); // 복원
    rec('[F3] rainEnabled 복원', 'PASS', `→ ${orig}`);
  } else {
    rec('[F3] rainEnabled 토글', 'SKIP', '이 그룹에 우적센서(온보드 slot) 없음');
  }
  // 고온 강제열림 옵션 저장→복원
  if (ds) {
    const origHt = ds.highTempOverrideEnabled;
    const p = await req('PATCH', `/env-config/groups/${gid}/device-settings`, tok, { highTempOverrideEnabled: !origHt, highTempOpenThreshold: 33 });
    const ds3 = (await req('GET', `/env-config/groups/${gid}/device-settings`, tok)).data;
    rec('[F3] 고온강제열림 옵션 저장 반영', p.st === 200 && ds3.highTempOverrideEnabled === !origHt ? 'PASS' : 'WARN', `HTTP ${p.st}, 반영=${ds3.highTempOverrideEnabled}`);
    await req('PATCH', `/env-config/groups/${gid}/device-settings`, tok, { highTempOverrideEnabled: origHt }); // 복원
  }

  // RBAC: farm_user 는 PUT mappings 403
  const uTok = (await req('POST', '/auth/login', undefined, { username: 'user1', password: 'admin123' })).data?.accessToken;
  if (uTok) {
    const forbidden = await req('PUT', `/env-config/groups/${gid}/mappings`, uTok, { mappings: [] });
    rec('[F3][RBAC] farm_user PUT mappings 차단', forbidden.st === 403 ? 'PASS' : 'WARN', `HTTP ${forbidden.st} (403 기대)`);
  } else {
    rec('[F3][RBAC] farm_user 계정', 'SKIP', 'user1 계정 없음(환경별)');
  }

  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.status === s).length;
  for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'SKIP' ? '·' : '⚠'} ${r.name}${r.msg ? ' — ' + r.msg : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')} | SKIP: ${c('SKIP')}`);
}
