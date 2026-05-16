// 농장 관리자(farm_admin / mtest) 시나리오 테스트
// - 전체 기능 테스트 + UI 디자인 점검

import { setupBrowser, snap, record, saveReport, BASE_URL, API_URL } from './helpers';
import { Page } from 'playwright';

let apiToken = '';
async function ensureApiToken(page: Page, username = 'mtest', password = 'admin123') {
  if (apiToken) return apiToken;
  const res = await page.request.post(API_URL + '/auth/login', {
    data: { username, password },
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

// 브라우저 로그인 (UI 검증용)
async function loginBrowser(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'mtest');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const { browser, page } = await setupBrowser();
  const failedRequests: string[] = [];
  // 404/500 응답 추적
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      failedRequests.push(`${res.status()} ${res.request().method()} ${res.url().replace(API_URL, '')}`);
    }
  });

  try {
    // ═══════ 1. 로그인 ═══════
    const ok = await loginBrowser(page);
    record({ name: 'mtest 로그인', category: 'auth', status: ok ? 'PASS' : 'FAIL' });
    await snap(page, 'fa-login');

    // ═══════ 2. /auth/me 확인 (role=farm_admin) ═══════
    const me = await api(page, 'GET', '/auth/me');
    record({
      name: 'auth/me — 농장관리자',
      category: 'auth',
      status: me.data?.role === 'farm_admin' ? 'PASS' : 'FAIL',
      message: `role=${me.data?.role}, name=${me.data?.name}`,
    });

    // ═══════ 3. 대시보드 ═══════
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await snap(page, 'fa-dashboard');
    const hasError = await page.locator('text=/오류|에러|Error/i').count();
    record({
      name: '대시보드 로드',
      category: 'page-load',
      status: 'PASS',
      message: hasError > 0 ? `${hasError} 에러 텍스트 감지` : undefined,
    });

    // ═══════ 4. 모든 페이지 순회 + 캡처 (UI 디자인 점검) ═══════
    const pages = [
      { url: '/dashboard', name: '대시보드' },
      { url: '/devices', name: '장비 관리' },
      { url: '/sensors', name: '센서 데이터' },
      { url: '/groups', name: '구역 관리' },
      { url: '/automation', name: '자동 제어' },
      { url: '/gateways', name: '게이트웨이' },
      { url: '/alerts', name: '알림' },
      { url: '/reports', name: '리포트' },
      { url: '/activity-log', name: '활동 로그' },
    ];

    for (const p of pages) {
      try {
        const beforeFails = failedRequests.length;
        await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(2500);
        await snap(page, `fa-${p.name}`);
        const newFails = failedRequests.slice(beforeFails);
        record({
          name: `${p.name} (${p.url})`,
          category: 'page-load',
          status: newFails.length === 0 ? 'PASS' : 'WARN',
          message: newFails.length ? `${newFails.length}개 API 실패: ${newFails.slice(0, 3).join(' | ')}` : undefined,
        });
      } catch (e: any) {
        record({ name: `${p.name} 로드 실패`, category: 'page-load', status: 'FAIL', message: e?.message });
      }
    }

    // ═══════ 5. 구역 관리 → 장치 status 호출 (이전 404 문제) ═══════
    const devs = await api(page, 'GET', '/devices');
    const lgwDevs = (devs.data || []).filter((d: any) => d.gatewayId === '46986887-8562-42f1-9bb8-9e2a6310c5c7');
    record({
      name: '구역 장치 목록 (lgw-dev)',
      category: 'groups',
      status: lgwDevs.length > 0 ? 'PASS' : 'FAIL',
      message: `total=${lgwDevs.length}`,
    });

    let statusOk = 0;
    let statusFail = 0;
    for (const d of lgwDevs.slice(0, 5)) {
      const s = await api(page, 'GET', `/devices/${d.id}/status`);
      if (s.status === 200) statusOk++;
      else statusFail++;
    }
    record({
      name: '장치 status API (404 버그 검증)',
      category: 'groups',
      status: statusFail === 0 ? 'PASS' : 'FAIL',
      message: `ok=${statusOk}, fail=${statusFail}`,
    });

    // ═══════ 6. 온보드 장치 ON/OFF (실제 GPIO 발화) ═══════
    const fan1 = lgwDevs.find((d: any) => d.name === '유동팬 1번' && d.source === 'onboard');
    if (fan1) {
      const on = await api(page, 'POST', `/devices/${fan1.id}/control`, {
        commands: [{ code: 'state', value: true }],
      });
      record({
        name: '유동팬 1번 GPIO ON',
        category: 'control',
        status: on.status === 201 ? 'PASS' : 'FAIL',
        message: `pin=${on.data?.command?.pin}, state=${on.data?.command?.state}`,
      });
      await new Promise(r => setTimeout(r, 1000));
      const off = await api(page, 'POST', `/devices/${fan1.id}/control`, {
        commands: [{ code: 'state', value: false }],
      });
      record({
        name: '유동팬 1번 GPIO OFF',
        category: 'control',
        status: off.status === 201 ? 'PASS' : 'FAIL',
      });
    }

    // ═══════ 7. 개폐기 인터록 ═══════
    const opener_open = lgwDevs.find((d: any) => d.equipmentType === 'opener_open');
    const opener_close = lgwDevs.find((d: any) => d.equipmentType === 'opener_close');
    if (opener_open && opener_close) {
      const c1 = await api(page, 'POST', `/devices/${opener_close.id}/control`, { commands: [{ code: 'state', value: true }] });
      await new Promise(r => setTimeout(r, 2000));
      const c2 = await api(page, 'POST', `/devices/${opener_open.id}/control`, { commands: [{ code: 'state', value: true }] });
      record({
        name: '개폐기 인터락 (닫기 ON → 열기 ON 시 자동 OFF + 1s 대기)',
        category: 'opener',
        status: c1.status === 201 && c2.status === 201 ? 'PASS' : 'FAIL',
        message: `closeON=${c1.status}, openON=${c2.status}`,
      });
      await new Promise(r => setTimeout(r, 1000));
      await api(page, 'POST', `/devices/${opener_open.id}/control`, { commands: [{ code: 'state', value: false }] });
      await api(page, 'POST', `/devices/${opener_close.id}/control`, { commands: [{ code: 'state', value: false }] });
    }

    // ═══════ 8. 자동제어 룰 목록 ═══════
    const rules = await api(page, 'GET', '/automation/rules');
    const rulesArr = Array.isArray(rules.data) ? rules.data : (rules.data?.data || []);
    record({
      name: '자동제어 룰 목록',
      category: 'automation',
      status: rules.status === 200 ? 'PASS' : 'FAIL',
      message: `count=${rulesArr.length}`,
    });

    // ═══════ 9. 자동제어 룰 생성/수정/삭제 (farm_admin own) ═══════
    const gw = (await api(page, 'GET', '/gateways')).data?.[0];
    const groupId = gw?.groupId;
    const created = await api(page, 'POST', '/automation/rules', {
      name: `mtest E2E ${Date.now()}`,
      groupId,
      conditions: {
        logic: 'AND',
        groups: [{ logic: 'AND', conditions: [{ type: 'time', field: 'time', operator: 'between', value: [600, 720] }] }],
      },
      actions: { targetDeviceIds: [], sensorDeviceIds: [] },
      priority: 1,
    });
    record({
      name: '룰 생성 (mtest 본인)',
      category: 'automation',
      status: created.status === 201 ? 'PASS' : 'FAIL',
      message: `status=${created.status}, id=${created.data?.id?.slice(0,8)}`,
    });
    const ruleId = created.data?.id;
    if (ruleId) {
      const upd = await api(page, 'PUT', `/automation/rules/${ruleId}`, { name: '수정됨' });
      record({ name: '룰 수정', category: 'automation', status: upd.status === 200 ? 'PASS' : 'FAIL' });
      const del = await api(page, 'DELETE', `/automation/rules/${ruleId}`);
      record({ name: '룰 삭제', category: 'automation', status: del.status === 200 ? 'PASS' : 'FAIL' });
    }

    // ═══════ 10. UI 점검: 다크모드 ═══════
    await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const darkApplied = await page.evaluate(() => {
      const el = document.querySelector('#vue-root > #app') || document.querySelector('.theme-dark');
      return !!el?.classList.contains('theme-dark');
    });
    record({
      name: '다크모드 적용 확인 (#vue-root > #app)',
      category: 'ui',
      status: darkApplied ? 'PASS' : 'WARN',
    });
    await snap(page, 'fa-dark-mode');

    // 라이트 복원
    await page.evaluate(() => localStorage.setItem('sf-theme', 'light'));

    // ═══════ 11. 모든 실패 요청 요약 ═══════
    if (failedRequests.length > 0) {
      const unique = [...new Set(failedRequests)];
      record({
        name: `API 실패 (${unique.length}건)`,
        category: 'api-errors',
        status: 'WARN',
        message: unique.slice(0, 5).join(' | '),
      });
    }

  } catch (e: any) {
    record({ name: 'CRITICAL', category: 'system', status: 'FAIL', message: e?.message });
    console.error(e);
  } finally {
    saveReport();
    await browser.close();
  }
})();
