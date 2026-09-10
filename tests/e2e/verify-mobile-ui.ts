/**
 * verify-mobile-ui.ts — 모바일 폰트 2단계 + 관주현황 위젯 (#18)
 *  - 글자 크기 보통(md)/크게(lg) → #app.content-size-* 토글 + 본문 폰트 증가 + localStorage 유지
 *  - 대시보드 관주현황 위젯 렌더 확인
 */
import { setupBrowser, login, snap, record, saveReport, results, BASE_URL } from './helpers';

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    if (!(await login(page))) { record({ name: 'login', category: 'mobile-ui', status: 'FAIL' }); saveReport(); await browser.close(); return; }
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const appCls = () => page.evaluate(() => document.getElementById('app')?.className ?? '');
    const bodyFont = () => page.evaluate(() => {
      const el = document.querySelector('.main-content p, .main-content .card, .main-content span') as HTMLElement | null;
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });

    // 보통(md) 설정
    await page.evaluate(() => { localStorage.setItem('sf-font-size', 'md'); });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const mdCls = await appCls();
    const mdFont = await bodyFont();
    record({ name: '[#18] 보통 → #app.content-size-md', category: 'mobile-ui', status: mdCls.includes('content-size-md') ? 'PASS' : 'FAIL', message: mdCls });

    // 크게(lg) 설정
    await page.evaluate(() => { localStorage.setItem('sf-font-size', 'lg'); });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const lgCls = await appCls();
    const lgFont = await bodyFont();
    record({ name: '[#18] 크게 → #app.content-size-lg', category: 'mobile-ui', status: lgCls.includes('content-size-lg') ? 'PASS' : 'FAIL', message: lgCls });
    record({ name: '[#18] 크게가 보통보다 본문 폰트 큼', category: 'mobile-ui', status: lgFont > mdFont ? 'PASS' : 'WARN', message: `md=${mdFont}px, lg=${lgFont}px` });

    // localStorage 유지
    const saved = await page.evaluate(() => localStorage.getItem('sf-font-size'));
    record({ name: '[#18] sf-font-size 저장 유지', category: 'mobile-ui', status: saved === 'lg' ? 'PASS' : 'FAIL', message: String(saved) });

    // 관주현황 위젯 렌더 (제목 텍스트로 확인)
    const hasWidget = await page.evaluate(() => Array.from(document.querySelectorAll('h3, .widget-header h3')).some(el => /관주\s*현황/.test(el.textContent ?? '')));
    record({ name: '[#18] 관주현황 위젯 렌더', category: 'mobile-ui', status: hasWidget ? 'PASS' : 'WARN', message: hasWidget ? 'O' : '대시보드에 위젯 미표시(레이아웃 설정?)' });

    await page.evaluate(() => localStorage.setItem('sf-font-size', 'md')); // 복원
    await snap(page, 'mobile-ui-lg');
  } catch (e: any) {
    record({ name: 'exception', category: 'mobile-ui', status: 'FAIL', message: e?.message ?? String(e) });
  } finally {
    const c = (s: string) => results.filter(r => r.status === s).length;
    for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'SKIP' ? '·' : '⚠'} ${r.name}${r.message ? ' — ' + r.message : ''}`);
    console.log(`Total: ${results.length} | PASS: ${c('PASS')} | FAIL: ${c('FAIL')} | WARN: ${c('WARN')}`);
    saveReport();
    await browser.close();
  }
})();
