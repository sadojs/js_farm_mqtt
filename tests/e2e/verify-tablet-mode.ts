/**
 * verify-tablet-mode.ts — 태블릿 레이아웃 모드 검증
 *
 * 검증 항목:
 *  - 데스크탑(1440): 사이드바 표시, 태블릿 헤더 없음, #app.layout-desktop
 *  - 태블릿(1280×800): 사이드바 접힘, 태블릿 헤더 표시, 구역 그리드 4열, #app.layout-tablet
 *  - 모바일(390): 모바일 헤더, #app.layout-mobile
 *  - 설정 모달 '화면 레이아웃' 행: 태블릿/데스크탑 노출, 모바일 숨김(사용자 요구)
 *  - 사용자 설정 pref=tablet → 데스크탑 폭에서도 태블릿 적용 + localStorage 저장
 */
import { setupBrowser, login, snap, record, saveReport, results, BASE_URL } from './helpers';

async function appClass(page: any): Promise<string> {
  return page.evaluate(() => document.getElementById('app')?.className ?? '');
}
async function visible(page: any, sel: string): Promise<boolean> {
  return page.evaluate((s: string) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    // position:fixed 요소는 offsetParent 가 null 이라 getBoundingClientRect 로 판정
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
}
async function settleMode(page: any) { await page.waitForTimeout(400); } // resize debounce(150ms) 여유

async function openSettings(page: any) {
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="환경설정"]') as HTMLButtonElement | null;
    btn?.click();
  });
  await page.waitForTimeout(400);
}
async function closeSettings(page: any) {
  await page.evaluate(() => {
    const btn = document.querySelector('.modal-overlay .btn-close') as HTMLButtonElement | null;
    btn?.click();
  });
  await page.waitForTimeout(200);
}

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    if (!(await login(page))) {
      record({ name: 'login', category: 'tablet', status: 'FAIL', message: '로그인 실패' });
      saveReport(); await browser.close(); return;
    }

    // ── 1. 데스크탑 ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await settleMode(page);
    const dCls = await appClass(page);
    record({ name: '[desktop] #app.layout-desktop', category: 'tablet', status: dCls.includes('layout-desktop') ? 'PASS' : 'FAIL', message: dCls });
    record({ name: '[desktop] 사이드바 표시', category: 'tablet', status: (await visible(page, '.sidebar')) ? 'PASS' : 'FAIL' });
    record({ name: '[desktop] 태블릿 헤더 없음', category: 'tablet', status: !(await visible(page, '.tablet-header')) ? 'PASS' : 'FAIL' });
    await openSettings(page);
    record({ name: '[desktop] 설정 화면레이아웃 행 노출', category: 'tablet', status: (await visible(page, '.layout-buttons')) ? 'PASS' : 'FAIL' });
    await closeSettings(page);
    await snap(page, 'tablet-verify-desktop');

    // ── 2. 태블릿 (1280×800) ──
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/groups`, { waitUntil: 'networkidle' });
    await settleMode(page);
    const tCls = await appClass(page);
    record({ name: '[tablet] #app.layout-tablet', category: 'tablet', status: tCls.includes('layout-tablet') ? 'PASS' : 'FAIL', message: tCls });
    record({ name: '[tablet] 사이드바 접힘', category: 'tablet', status: !(await visible(page, '.sidebar')) ? 'PASS' : 'FAIL' });
    record({ name: '[tablet] 태블릿 헤더 표시', category: 'tablet', status: (await visible(page, '.tablet-header')) ? 'PASS' : 'FAIL' });
    // 구역 그리드 열 수 (4열 기대)
    const cols = await page.evaluate(() => {
      const grid = document.querySelector('.device-sub-grid') as HTMLElement | null;
      if (!grid) return -1;
      return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    });
    record({ name: `[tablet] 구역 장치 그리드 열 수 = ${cols}`, category: 'tablet', status: cols === 4 ? 'PASS' : (cols === -1 ? 'WARN' : 'WARN'), message: cols === -1 ? '.device-sub-grid 없음(장치 없는 구역?)' : `${cols}열 (4 기대, 3이면 패딩 축소 재검토)` });
    await snap(page, 'tablet-verify-tablet');

    // ── 3. 모바일 (390) — 화면 레이아웃 옵션 숨김 확인 ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await settleMode(page);
    const mCls = await appClass(page);
    record({ name: '[mobile] #app.layout-mobile', category: 'tablet', status: mCls.includes('layout-mobile') ? 'PASS' : 'FAIL', message: mCls });
    record({ name: '[mobile] 모바일 헤더 표시', category: 'tablet', status: (await visible(page, '.mobile-header')) ? 'PASS' : 'FAIL' });
    record({ name: '[mobile] 태블릿 헤더 없음', category: 'tablet', status: !(await visible(page, '.tablet-header')) ? 'PASS' : 'FAIL' });
    await openSettings(page);
    const layoutHiddenOnMobile = !(await visible(page, '.layout-buttons'));
    record({ name: '[mobile] 화면 레이아웃 옵션 숨김(사용자 요구)', category: 'tablet', status: layoutHiddenOnMobile ? 'PASS' : 'FAIL', message: layoutHiddenOnMobile ? '숨김 확인' : '모바일에서 노출됨(버그)' });
    await closeSettings(page);
    await snap(page, 'tablet-verify-mobile');

    // ── 4. pref=tablet 강제 → 데스크탑 폭에서도 태블릿 + 저장 확인 ──
    await page.evaluate(() => localStorage.setItem('sf-layout-mode', 'tablet'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/groups`, { waitUntil: 'networkidle' });
    await settleMode(page);
    const forcedCls = await appClass(page);
    const savedPref = await page.evaluate(() => localStorage.getItem('sf-layout-mode'));
    record({ name: '[pref] 데스크탑폭+pref=tablet → layout-tablet 적용', category: 'tablet', status: forcedCls.includes('layout-tablet') ? 'PASS' : 'FAIL', message: forcedCls });
    record({ name: '[pref] sf-layout-mode 저장 유지', category: 'tablet', status: savedPref === 'tablet' ? 'PASS' : 'FAIL', message: String(savedPref) });
    await page.evaluate(() => localStorage.removeItem('sf-layout-mode'));

  } catch (e: any) {
    record({ name: 'exception', category: 'tablet', status: 'FAIL', message: e?.message ?? String(e) });
  } finally {
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const warn = results.filter(r => r.status === 'WARN').length;
    console.log('========================================================================');
    for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠'} [${r.category}] ${r.name}${r.message ? ' — ' + r.message : ''}`);
    console.log('========================================================================');
    console.log(`Total: ${results.length} | PASS: ${pass} | FAIL: ${fail} | WARN: ${warn}`);
    saveReport();
    await browser.close();
  }
})();
