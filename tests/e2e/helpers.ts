import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export const BASE_URL = 'https://localhost:5176';
export const API_URL = 'http://localhost:3100/api';

export interface TestResult {
  name: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  message?: string;
  screenshot?: string;
  details?: any;
}

export const results: TestResult[] = [];
export const screenshotDir = '/tmp/sf-e2e-screenshots';

export async function setupBrowser(): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  // 콘솔 에러 캡처
  page.on('pageerror', (err) => {
    record({ name: 'console:pageerror', category: 'browser', status: 'WARN', message: err.message });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // 노이즈 필터 (401 인증 실패, 정적 리소스 로드 실패, CORS 등은 정상 흐름)
      if (
        txt.includes('favicon') ||
        txt.includes('manifest') ||
        txt.includes('401') ||
        txt.includes('Failed to load resource') ||
        txt.includes('CORS policy') ||
        txt.includes('net::ERR_FAILED')
      ) return;
      record({ name: 'console:error', category: 'browser', status: 'WARN', message: txt.slice(0, 200) });
    }
  });
  return { browser, ctx, page };
}

export function record(r: TestResult) {
  results.push(r);
  const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'WARN' ? '⚠' : '○';
  console.log(`${icon} [${r.category}] ${r.name}${r.message ? ' — ' + r.message : ''}`);
}

export async function snap(page: Page, name: string): Promise<string> {
  const file = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

export async function login(page: Page, username = 'admin', password = 'Sessadojs3535!@'): Promise<boolean> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]', username);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], button.btn-login');
  try {
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

export function saveReport() {
  const passes = results.filter((r) => r.status === 'PASS').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  const skips = results.filter((r) => r.status === 'SKIP').length;
  const summary = `Total: ${results.length} | PASS: ${passes} | FAIL: ${fails} | WARN: ${warns} | SKIP: ${skips}`;
  console.log('\n' + '='.repeat(72));
  console.log(summary);
  console.log('='.repeat(72));
  fs.writeFileSync('/tmp/sf-e2e-report.json', JSON.stringify({ summary, results }, null, 2));
  console.log('Report saved: /tmp/sf-e2e-report.json');
  console.log('Screenshots: ' + screenshotDir);
}
