import { setupBrowser, record, saveReport, BASE_URL, API_URL, snap } from './helpers';
import { Page } from 'playwright';

// 일정 시간 후 시작/종료되는 룰을 만들어 실제 트리거를 검증

let apiToken = '';
async function ensureApiToken(page: Page) {
  if (apiToken) return apiToken;
  const res = await page.request.post(API_URL + '/auth/login', {
    data: { username: 'admin', password: 'Sessadojs3535!@' },
    headers: { 'Content-Type': 'application/json' },
  });
  apiToken = (await res.json()).accessToken;
  return apiToken;
}

async function api(page: Page, method: string, path: string, body?: any) {
  await ensureApiToken(page);
  const opts: any = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` } };
  if (body) opts.data = body;
  const res = await (page.request as any)[method.toLowerCase()](API_URL + path, opts);
  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status(), data };
}

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    // 1) 기존 룰의 groupId 가져오기 (lgw-dev 가 속한 그룹)
    const gws = await api(page, 'GET', '/gateways');
    const lgwDev = gws.data?.find((g: any) => g.gatewayId === 'lgw-dev');
    const groupId = lgwDev?.groupId;
    const houseId = lgwDev?.houseId;
    record({
      name: '게이트웨이 그룹 정보 조회',
      category: 'setup',
      status: groupId ? 'PASS' : 'FAIL',
      message: `groupId=${groupId}, houseId=${houseId}`,
    });
    if (!groupId) { saveReport(); await browser.close(); return; }

    // 2) 현재 시각 + 2분 ~ + 3분 사이에 트리거되는 룰 생성
    const now = new Date();
    const startMin = now.getHours() * 60 + now.getMinutes() + 2;
    const endMin = startMin + 1;
    const ruleName = `E2E_LIVE_TRIGGER_${Date.now()}`;
    const created = await api(page, 'POST', '/automation/rules', {
      name: ruleName,
      description: '2분 후 자동 트리거 확인',
      groupId,
      conditions: {
        logic: 'AND',
        groups: [{
          logic: 'AND',
          conditions: [
            { type: 'time', field: 'time', operator: 'between', value: [startMin, endMin] },
          ],
        }],
      },
      actions: { targetDeviceId: null, targetDeviceIds: [], sensorDeviceIds: [] },
      priority: 1,
    });
    record({
      name: `룰 생성 (${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')} ~ ${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')})`,
      category: 'live-trigger',
      status: created.status === 201 ? 'PASS' : 'FAIL',
      message: `id=${created.data?.id} ${created.data?.message || ''}`,
    });
    const ruleId = created.data?.id;
    if (!ruleId) { saveReport(); await browser.close(); return; }

    // 3) 룰 조회로 저장된 값 확인 (formatCondition을 통해 정상 표시되는지)
    const ruleDetail = await api(page, 'GET', `/automation/rules`);
    const myRule = ruleDetail.data?.find((r: any) => r.id === ruleId);
    record({
      name: '저장된 룰의 conditions 확인',
      category: 'live-trigger',
      status: myRule ? 'PASS' : 'FAIL',
      message: `value=${JSON.stringify(myRule?.conditions?.groups?.[0]?.conditions?.[0]?.value)}`,
    });

    // 4) 자동제어 로그를 매 30초마다 폴링 (총 4분)
    console.log(`\n⏳ 대기 시작 — 트리거 예상 시각: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}`);
    let triggered = false;
    const startTime = Date.now();
    const maxWaitMs = 4 * 60 * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 30000));
      const logs = await api(page, 'GET', `/automation/logs?ruleId=${ruleId}&limit=10`);
      const arr = Array.isArray(logs.data) ? logs.data : (logs.data?.data || []);
      console.log(`  [${new Date().toLocaleTimeString()}] logs count=${arr.length}`);
      if (arr.length > 0) {
        triggered = true;
        record({
          name: '자동제어 룰 실제 트리거 (DB 로그)',
          category: 'live-trigger',
          status: 'PASS',
          message: `executed_at=${arr[0].executedAt || arr[0].executed_at}, success=${arr[0].success}`,
        });
        break;
      }
    }

    if (!triggered) {
      record({
        name: '자동제어 룰 트리거 확인',
        category: 'live-trigger',
        status: 'FAIL',
        message: '4분 안에 트리거 로그가 생성되지 않음',
      });
    }

    // 5) 정리 — 테스트 룰 삭제
    await api(page, 'DELETE', `/automation/rules/${ruleId}`);
    record({ name: '테스트 룰 정리 (삭제)', category: 'cleanup', status: 'PASS' });
  } catch (e: any) {
    record({ name: 'CRITICAL', category: 'system', status: 'FAIL', message: e?.message });
  } finally {
    saveReport();
    await browser.close();
  }
})();
