// 농장 사용자(farm_user / user1) 시나리오 테스트
// user1 = mtest 농장에 속한 farm_user (parentUserId = mtest)

import { setupBrowser, snap, record, saveReport, BASE_URL, API_URL } from './helpers';
import { Page } from 'playwright';

let apiToken = '';
async function ensureApiToken(page: Page) {
  if (apiToken) return apiToken;
  const res = await page.request.post(API_URL + '/auth/login', {
    data: { username: 'user1', password: 'admin123' },
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

async function loginBrowser(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'user1');
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
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      failedRequests.push(`${res.status()} ${res.request().method()} ${res.url().replace(API_URL, '')}`);
    }
  });

  try {
    // 1. 로그인 + 역할 확인
    const ok = await loginBrowser(page);
    record({ name: 'user1 로그인', category: 'auth', status: ok ? 'PASS' : 'FAIL' });
    await snap(page, 'fu-login');

    const me = await api(page, 'GET', '/auth/me');
    record({
      name: 'auth/me — farm_user',
      category: 'auth',
      status: me.data?.role === 'farm_user' ? 'PASS' : 'FAIL',
      message: `role=${me.data?.role}, parentUserId=${me.data?.parentUserId?.slice(0,8)}`,
    });

    // 2. 페이지 접근 권한 점검
    const allowedPages = [
      { url: '/dashboard', name: '대시보드' },
      { url: '/groups', name: '구역 관리' },
      { url: '/sensors', name: '센서 데이터' },
      { url: '/alerts', name: '알림' },
    ];
    for (const p of allowedPages) {
      const before = failedRequests.length;
      await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(2000);
      await snap(page, `fu-${p.name}`);
      const newFails = failedRequests.slice(before);
      record({
        name: `접근: ${p.name}`,
        category: 'page-load',
        status: newFails.length === 0 ? 'PASS' : 'WARN',
        message: newFails.length ? `${newFails.length}개 API 실패` : undefined,
      });
    }

    // 3. farm_user는 admin 페이지 접근 불가 확인
    const restrictedPages = [
      { url: '/users', name: '사용자 관리 (admin 전용)' },
      { url: '/gateways', name: '게이트웨이 (denyFarmUser)' },
    ];
    for (const p of restrictedPages) {
      await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(1500);
      // 라우터 가드가 동작하면 다른 경로로 redirect 됐을 것
      const currentUrl = page.url();
      const redirected = !currentUrl.includes(p.url);
      record({
        name: `차단: ${p.name}`,
        category: 'access-control',
        status: redirected ? 'PASS' : 'WARN',
        message: redirected ? `redirect → ${currentUrl.replace(BASE_URL, '')}` : '접근 가능 (의도된 권한인지 확인)',
      });
    }

    // 4. 부모(mtest)의 device 조회 권한
    const devs = await api(page, 'GET', '/devices');
    const lgwDevs = Array.isArray(devs.data) ? devs.data.filter((d: any) => d.gatewayId === '46986887-8562-42f1-9bb8-9e2a6310c5c7') : [];
    record({
      name: '부모(mtest) 게이트웨이 device 조회',
      category: 'data-access',
      status: lgwDevs.length > 0 ? 'PASS' : 'FAIL',
      message: `${lgwDevs.length}개 device 보임`,
    });

    // 5. device 상태 조회
    const fan1 = lgwDevs.find((d: any) => d.name === '유동팬 1번' && d.source === 'onboard');
    if (fan1) {
      const s = await api(page, 'GET', `/devices/${fan1.id}/status`);
      record({
        name: 'device status (parentUserId 매칭)',
        category: 'data-access',
        status: s.status === 200 ? 'PASS' : 'FAIL',
        message: `status=${s.status}`,
      });

      // 6. device 제어 시도 (farm_user 권한)
      const ctl = await api(page, 'POST', `/devices/${fan1.id}/control`, {
        commands: [{ code: 'state', value: true }],
      });
      record({
        name: 'device 제어 (farm_user)',
        category: 'control',
        status: ctl.status === 200 || ctl.status === 201 ? 'PASS' : 'WARN',
        message: `status=${ctl.status}`,
      });
      // 정리
      await api(page, 'POST', `/devices/${fan1.id}/control`, { commands: [{ code: 'state', value: false }] });
    }

    // 7. 자동제어 룰 조회 (부모 농장 룰 봐야 함)
    const rules = await api(page, 'GET', '/automation/rules');
    const rulesArr = Array.isArray(rules.data) ? rules.data : (rules.data?.data || []);
    record({
      name: '자동제어 룰 조회 (부모 농장)',
      category: 'automation',
      status: rules.status === 200 ? 'PASS' : 'FAIL',
      message: `count=${rulesArr.length}`,
    });

    // 8. 다크모드
    await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const darkOk = await page.evaluate(() => !!document.querySelector('.theme-dark'));
    record({ name: '다크모드', category: 'ui', status: darkOk ? 'PASS' : 'WARN' });
    await snap(page, 'fu-dark');

    // 9. API 에러 요약
    if (failedRequests.length > 0) {
      const unique = [...new Set(failedRequests)];
      record({
        name: `API 에러 (${unique.length}개)`,
        category: 'api-errors',
        status: 'WARN',
        message: unique.slice(0, 5).join(' | '),
      });
    }
  } catch (e: any) {
    record({ name: 'CRITICAL', category: 'system', status: 'FAIL', message: e?.message });
  } finally {
    saveReport();
    await browser.close();
  }
})();
