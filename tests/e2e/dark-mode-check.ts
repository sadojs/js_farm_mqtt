import { setupBrowser, login, snap, record, saveReport, BASE_URL } from './helpers';

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    // 1) 로그인 → 라이트 모드 기본
    await login(page);

    // 2) localStorage에 'sf-theme' 설정 (앞 단계는 라이트라 가정)
    await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));

    // 3) 페이지 새로고침 — 이때 App.vue가 새로 mount되며 localStorage 읽음
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const cls = app?.className || '';
      const has = app?.classList.contains('theme-dark');
      const bg = getComputedStyle(app as HTMLElement).backgroundColor;
      const theme = localStorage.getItem('sf-theme');
      return { cls, has, bg, theme };
    });
    record({
      name: 'Reload 후 다크모드 적용',
      category: 'dark-mode',
      status: result.has ? 'PASS' : 'FAIL',
      message: `class="${result.cls}" bg=${result.bg} theme=${result.theme}`,
    });
    await snap(page, 'dark-mode-applied');

    // 4) 여러 페이지 다크모드 적용 확인
    const pages = [
      '/dashboard', '/devices', '/sensors', '/groups',
      '/automation', '/gateways', '/users', '/alerts', '/reports'
    ];
    for (const url of pages) {
      await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const has = await page.evaluate(() => document.querySelector('#app')?.classList.contains('theme-dark'));
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#app') as HTMLElement).backgroundColor);
      record({
        name: `다크모드: ${url}`,
        category: 'dark-mode',
        status: has ? 'PASS' : 'FAIL',
        message: `bg=${bg}`,
      });
      await snap(page, `dm-${url.replace(/\//g, '_')}`);
    }
  } catch (e: any) {
    record({ name: 'ERROR', category: 'system', status: 'FAIL', message: e?.message });
  } finally {
    saveReport();
    await browser.close();
  }
})();
