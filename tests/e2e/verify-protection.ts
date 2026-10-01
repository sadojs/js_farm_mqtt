import { setupBrowser, record, snap, saveReport } from './helpers';

const BASE = process.env.SF_BASE || 'https://localhost:5175';

async function login(page: any): Promise<boolean> {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]', 'admin');
  await page.fill('input[name="password"], input[type="password"]', 'Sessadojs3535!@');
  await page.click('button[type="submit"], button.btn-login');
  try {
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    const ok = await login(page);
    record({ name: 'login', category: 'protection', status: ok ? 'PASS' : 'FAIL' });
    if (!ok) throw new Error('login failed');

    await page.goto(`${BASE}/groups`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 1) 방재 버튼 존재
    const btn = page.locator('.btn-protection');
    const hasBtn = await btn.count();
    record({ name: '방재 버튼 렌더', category: 'protection', status: hasBtn ? 'PASS' : 'FAIL', message: `count=${hasBtn}` });
    if (!hasBtn) throw new Error('no 방재 button');

    // 2) 모달 열림 + 3스텝
    await btn.first().click();
    await page.waitForTimeout(500);
    const panel = page.locator('.prot-panel');
    const panelVisible = await panel.isVisible();
    const secCount = await page.locator('.prot-sec-title').count();
    record({ name: '방재 모달 열림', category: 'protection', status: panelVisible && secCount === 3 ? 'PASS' : 'FAIL', message: `visible=${panelVisible} steps=${secCount}` });
    await snap(page, 'protection-modal');

    // 동작 체크박스 기본 ON 확인
    const checks = page.locator('.prot-check input[type="checkbox"]');
    const c0 = await checks.nth(0).isChecked();
    const c1 = await checks.nth(1).isChecked();
    record({ name: '동작 기본 ON (개폐기·유동팬)', category: 'protection', status: c0 && c1 ? 'PASS' : 'WARN', message: `openers=${c0} fans=${c1}` });

    // 3) 1시간 프리셋 선택 후 방재 시작
    await page.locator('.prot-presets button', { hasText: '1시간' }).first().click();
    await page.waitForTimeout(200);
    await page.locator('.prot-btn-go').click();
    await page.waitForTimeout(2500);

    // 4) 진행 배너 등장 + 연장/정지 버튼
    const banner = page.locator('.protection-banner');
    const bannerCount = await banner.count();
    const hasExtend = await page.locator('.pb-extend').count();
    const hasStop = await page.locator('.pb-stop').count();
    record({ name: '방재 시작 → 진행 배너', category: 'protection', status: bannerCount > 0 && hasExtend > 0 && hasStop > 0 ? 'PASS' : 'FAIL', message: `banner=${bannerCount} extend=${hasExtend} stop=${hasStop}` });
    const remainBefore = bannerCount ? await page.locator('.pb-remain').first().innerText() : '';
    await snap(page, 'protection-banner');

    // 5) 30분 연장
    if (hasExtend) {
      await page.locator('.pb-extend').first().click();
      await page.waitForTimeout(2000);
      const remainAfter = await page.locator('.pb-remain').first().innerText().catch(() => '');
      record({ name: '+30분 연장', category: 'protection', status: remainAfter && remainAfter !== remainBefore ? 'PASS' : 'WARN', message: `${remainBefore} → ${remainAfter}` });
    }

    // 6) 정지 (confirm 다이얼로그 수락)
    if (hasStop) {
      await page.locator('.pb-stop').first().click();
      await page.waitForTimeout(500);
      // 커스텀 confirm 모달의 확인 버튼 클릭
      const confirmBtn = page.locator('.confirm-btn.ok');
      if (await confirmBtn.count()) await confirmBtn.first().click();
      await page.waitForTimeout(2500);
      const bannerAfter = await page.locator('.protection-banner').count();
      record({ name: '즉시 정지 → 배너 제거', category: 'protection', status: bannerAfter === 0 ? 'PASS' : 'WARN', message: `banner=${bannerAfter}` });
      await snap(page, 'protection-stopped');
    }
  } catch (e: any) {
    record({ name: 'exception', category: 'protection', status: 'FAIL', message: e.message });
  } finally {
    saveReport();
    await browser.close();
  }
})();
