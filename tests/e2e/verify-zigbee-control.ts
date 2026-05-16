// 브라우저 자동화로 0xa4c1380b8b5e9df7 (Zigbee fan) 토글 → 팝업 캡쳐
import { chromium } from 'playwright';
import * as fs from 'fs';

const BASE_URL = 'https://localhost:5176';
const SCREENSHOT_DIR = '/tmp/sf-verify';

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function run(username: string, password: string, label: string) {
  console.log(`\n━━━ ${label} (${username}) ━━━`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const popups: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('상태 미변경') || t.includes('warning') || t.includes('warn')) {
      popups.push(`console: ${t.slice(0, 150)}`);
    }
  });

  // 로그인
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {});

  // 구역 관리
  await page.goto(`${BASE_URL}/groups`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${username}-groups-before.png`, fullPage: false });

  // 0xa4c1380b8b5e9df7 카드 토글 찾기
  const cardLocator = page.locator('text=0xa4c1380b8b5e9df7').first();
  const cardVisible = await cardLocator.isVisible().catch(() => false);
  console.log(`  fan card visible: ${cardVisible}`);

  if (cardVisible) {
    // 같은 카드 내의 토글 스위치를 찾아 클릭
    const card = await cardLocator.evaluate((el) => {
      // 부모 sub-card 찾기
      let p: HTMLElement | null = el as HTMLElement;
      while (p && !p.classList.contains('sub-card')) p = p.parentElement;
      return p ? (p as any).outerHTML.slice(0, 200) : null;
    });
    console.log(`  card found: ${!!card}`);

    // 토글 클릭
    const toggle = page.locator('text=0xa4c1380b8b5e9df7').first()
      .locator('xpath=ancestor::div[contains(@class, "sub-card")]')
      .locator('.toggle-switch, label.toggle-switch, input[type="checkbox"]').first();
    const toggleExists = await toggle.isVisible().catch(() => false);
    console.log(`  toggle visible: ${toggleExists}`);

    if (toggleExists) {
      await toggle.click();
      console.log(`  toggle clicked`);
      // 알림 팝업 등장 대기
      await page.waitForTimeout(3500);

      // 팝업 텍스트 캡쳐
      const allText = await page.locator('text=/상태 미변경|적용 완료|제어 실패|warning/i').allTextContents();
      console.log(`  popup texts: ${JSON.stringify(allText).slice(0, 200)}`);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${username}-toggle-result.png`, fullPage: false });

      // 다시 OFF
      await page.waitForTimeout(2000);
      await toggle.click().catch(() => {});
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${username}-toggle-off.png`, fullPage: false });
    }
  }

  console.log(`  console warnings/popups: ${popups.length}`);
  popups.slice(0, 3).forEach(p => console.log(`    ${p}`));

  await browser.close();
}

(async () => {
  await run('mtest', 'admin123', '농장 관리자');
  await run('admin', 'Sessadojs3535!@', '플랫폼 관리자');
})();
