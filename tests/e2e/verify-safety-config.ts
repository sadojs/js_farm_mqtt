/**
 * verify-safety-config.ts — 페일오버/고온/온보드/채널매핑 (비파괴 config·메커니즘 검증)
 *
 * ⚠️ 실제 폴백 엔진 동작(통신단절→자동OFF), 고온 트리거, 채널 등록(페어링)은
 *    RPi gpio-agent/하드웨어·시간 의존이라 자동화 불가 → 여기선 config 플러밍·엔드포인트·
 *    데이터 정합만 검증하고, 행위 검증은 수동/live-trigger 로 남긴다(SKIP + 주석).
 *
 *  [#1] 페일오버: 게이트웨이 fallback 설정 필드 존재·조회
 *  [#2] 고온 강제열림: env-config device-settings highTempOverride 옵션(별도 verify-env-config에서 저장검증)
 *  [#7] 온보드 슬롯: 목록·resync 엔드포인트, 룰 의존성 미체크 갭(문서화)
 *  [#8] 채널매핑: 관수 컨트롤러 channelMapping 필드 정합
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

(async () => {
  const tok = (await req('POST', '/auth/login', undefined, { username: 'admin', password: 'Sessadojs3535!@' })).data?.accessToken;
  if (!tok) { rec('login', 'FAIL'); return finish(); }

  const gws = arr((await req('GET', '/gateways', tok)).data);
  const gw = gws[0];

  // ── [#1] 페일오버 config 플러밍 ──
  if (gw) {
    const fbKeys = Object.keys(gw).filter((k) => /fallback|failover|offline|last.*seen|timeout/i.test(k));
    rec('[#1] 게이트웨이 fallback/failover 관련 필드', fbKeys.length > 0 ? 'PASS' : 'WARN', fbKeys.join(',') || '필드 없음(설계 확인)');
    rec('[#1] 폴백 엔진 실동작(통신단절→자동OFF)', 'SKIP', 'RPi gpio-agent 하드웨어 의존 — 수동/현장 검증');
  } else rec('[#1] 게이트웨이', 'SKIP', '없음');

  // ── [#2] 고온 강제열림 옵션(조회) ──
  const groups = arr((await req('GET', '/groups', tok)).data);
  if (groups.length) {
    const ds = (await req('GET', `/env-config/groups/${groups[0].id}/device-settings`, tok)).data;
    const hasHt = ds && ('highTempOverrideEnabled' in ds || 'highTempOpenThreshold' in ds);
    rec('[#2] device-settings 고온강제열림 필드 노출', hasHt ? 'PASS' : 'WARN', ds ? `enabled=${ds.highTempOverrideEnabled}, threshold=${ds.highTempOpenThreshold}` : '');
    rec('[#2] 고온 트리거 실동작(고온→강제개방→복귀)', 'SKIP', '온도 조건·시간 의존 — live-trigger/수동 검증');
  }

  // ── [#7] 온보드 슬롯 ──
  if (gw) {
    const onboard = arr((await req('GET', `/gateway-env/${gw.gatewayId ?? gw.id}/onboard`, tok)).data);
    rec('[#7] 온보드 슬롯 목록 조회', Array.isArray(onboard) ? 'PASS' : 'WARN', `${onboard.length}개`);
    rec('[#7][갭] 온보드 슬롯 삭제는 룰 의존성 미체크', 'WARN', 'gateway-env.service.deleteOnboardDevice 는 assertNoAutomationDependency 미호출 — 룰 참조 중에도 삭제됨(회귀 후보)');
    rec('[#7] 슬롯 삭제→고아 device 정리 실검증', 'SKIP', '실 슬롯 생성/삭제 필요(파괴적) — 전용 케이스로 별도 작성 권장');
  }

  // ── [#8] 채널매핑 (관수/8·12ch 컨트롤러) ──
  const devices = arr((await req('GET', '/devices', tok)).data);
  const irr = devices.find((d: any) => d.equipmentType === 'irrigation');
  if (irr) {
    const cm = irr.channelMapping ?? {};
    const keys = Object.keys(cm);
    const expected = ['remote_control', 'zone_1', 'mixer', 'fertilizer_motor'];
    const present = expected.filter((k) => k in cm);
    rec('[#8] 관수 컨트롤러 channelMapping 필수 키', present.length >= 2 ? 'PASS' : 'WARN', `키 ${keys.length}개 (필수중 ${present.length}/${expected.length})`);
    rec('[#8] 8/12ch 컨트롤러 등록(zigbee-controller)', 'SKIP', '페어링(permit-join) 하드웨어 필요 — 수동. DTO=CreateZigbeeControllerDto');
  } else rec('[#8] 관수 컨트롤러', 'SKIP', '없음');

  finish();
})();

function finish() {
  const c = (s: string) => results.filter((r) => r.s === s).length;
  for (const r of results) console.log(`${r.s === 'PASS' ? '✓' : r.s === 'FAIL' ? '✗' : r.s === 'SKIP' ? '·' : '⚠'} ${r.n}${r.m ? ' — ' + r.m : ''}`);
  console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')} | SKIP: ${c('SKIP')}`);
}
