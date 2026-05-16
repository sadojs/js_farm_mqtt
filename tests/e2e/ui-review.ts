// UI/UX 디자인 리뷰: 3계정 × 모든 페이지 × 라이트/다크 모드 스크린샷
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://localhost:5176';
const API_URL = 'http://localhost:3100/api';
const OUT_DIR = '/tmp/sf-ui-review';

const ACCOUNTS = [
  { username: 'admin', password: 'Sessadojs3535!@', role: 'admin' },
  { username: 'mtest', password: 'admin123', role: 'farm_admin' },
  { username: 'user1', password: 'admin123', role: 'farm_user' },
];

// 각 역할별 점검할 페이지
const PAGES_BY_ROLE: Record<string, { url: string; name: string }[]> = {
  admin: [
    { url: '/dashboard',     name: 'dashboard' },
    { url: '/devices',       name: 'devices' },
    { url: '/sensors',       name: 'sensors' },
    { url: '/groups',        name: 'groups' },
    { url: '/automation',    name: 'automation' },
    { url: '/gateways',      name: 'gateways' },
    { url: '/users',         name: 'users' },
    { url: '/alerts',        name: 'alerts' },
    { url: '/reports',       name: 'reports' },
    { url: '/activity-log',  name: 'activity-log' },
    { url: '/gateways/46986887-8562-42f1-9bb8-9e2a6310c5c7/env', name: 'gateway-env' },
  ],
  farm_admin: [
    { url: '/dashboard',     name: 'dashboard' },
    { url: '/groups',        name: 'groups' },
    { url: '/sensors',       name: 'sensors' },
    { url: '/automation',    name: 'automation' },
    { url: '/gateways',      name: 'gateways' },
    { url: '/alerts',        name: 'alerts' },
    { url: '/reports',       name: 'reports' },
    { url: '/activity-log',  name: 'activity-log' },
    { url: '/gateways/46986887-8562-42f1-9bb8-9e2a6310c5c7/env', name: 'gateway-env' },
  ],
  farm_user: [
    { url: '/dashboard',     name: 'dashboard' },
    { url: '/groups',        name: 'groups' },
    { url: '/sensors',       name: 'sensors' },
    { url: '/alerts',        name: 'alerts' },
  ],
};

// 특정 모달도 캡쳐
const MODAL_SCENARIOS: { name: string; setup: (page: Page) => Promise<void> }[] = [
  {
    name: 'automation-edit-modal',
    setup: async (page) => {
      await page.goto(`${BASE_URL}/automation`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      // 첫 룰의 편집 버튼 클릭
      const editBtn = page.locator('button:has-text("편집"), button:has-text("✏"), .rule-card').first();
      if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    },
  },
];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

interface Issue {
  page: string;
  category: string;
  severity: 'critical' | 'warning' | 'minor';
  description: string;
  screenshot?: string;
}
const issues: Issue[] = [];

async function login(page: Page, username: string, password: string): Promise<boolean> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function snap(page: Page, name: string): Promise<string> {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function detectIssues(page: Page, pageName: string, theme: string): Promise<void> {
  // 1. 가로 스크롤 존재? (overflow 가능성)
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasHorizontalScroll) {
    issues.push({
      page: `${pageName}-${theme}`,
      category: 'layout',
      severity: 'warning',
      description: '가로 스크롤 발생 — 콘텐츠가 viewport보다 넓음',
    });
  }

  // 2. 텍스트 오버플로 (... 잘림)
  const truncatedTexts = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all.filter(el => {
      const e = el as HTMLElement;
      return e.scrollWidth > e.clientWidth && getComputedStyle(e).overflow !== 'visible';
    }).length;
  });
  if (truncatedTexts > 30) {
    issues.push({
      page: `${pageName}-${theme}`,
      category: 'typography',
      severity: 'minor',
      description: `${truncatedTexts}개 요소에서 텍스트 잘림 가능성`,
    });
  }

  // 3. 다크모드: 흰색 하드코딩 배경 (대부분 다크모드에서 부조화)
  if (theme === 'dark') {
    const hardWhiteBgs = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all.filter(el => {
        const bg = getComputedStyle(el as HTMLElement).backgroundColor;
        return bg === 'rgb(255, 255, 255)' || bg === '#ffffff' || bg === '#fff';
      }).length;
    });
    if (hardWhiteBgs > 0) {
      issues.push({
        page: `${pageName}-${theme}`,
        category: 'dark-mode',
        severity: 'warning',
        description: `${hardWhiteBgs}개 요소에 하드코딩 흰 배경 (다크모드 부조화)`,
      });
    }
  }

  // 4. 너무 작은 클릭 영역 (< 32x32)
  const tinyButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 32 || r.height < 24);
    }).length;
  });
  if (tinyButtons > 5) {
    issues.push({
      page: `${pageName}-${theme}`,
      category: 'accessibility',
      severity: 'minor',
      description: `${tinyButtons}개 작은 버튼 (32x24 미만) — 모바일 터치 어려움`,
    });
  }

  // 5. CSS 변수 미사용 (하드코딩 색상)
  // 페이지별로 큰 차이 없으니 생략 (다크모드 점검에서 부분 커버)
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });

  for (const acc of ACCOUNTS) {
    const page = await ctx.newPage();
    console.log(`\n━━━ ${acc.role} (${acc.username}) ━━━`);
    const ok = await login(page, acc.username, acc.password);
    if (!ok) {
      issues.push({ page: 'login', category: 'auth', severity: 'critical', description: `${acc.username} 로그인 실패` });
      await page.close();
      continue;
    }

    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') {
        await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
      } else {
        await page.evaluate(() => localStorage.setItem('sf-theme', 'light'));
      }

      for (const p of PAGES_BY_ROLE[acc.role] || []) {
        try {
          await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
          await page.waitForTimeout(1500);
          const file = await snap(page, `${acc.role}-${p.name}-${theme}`);
          console.log(`  ${theme}/${p.name} → ${file.split('/').pop()}`);
          await detectIssues(page, p.name, theme);
        } catch (e: any) {
          issues.push({
            page: `${acc.role}-${p.name}-${theme}`,
            category: 'load',
            severity: 'critical',
            description: `로드 실패: ${e?.message?.slice(0, 80)}`,
          });
        }
      }
    }

    // 모달 시나리오 (admin 1회만)
    if (acc.role === 'admin') {
      await page.evaluate(() => localStorage.setItem('sf-theme', 'light'));
      for (const m of MODAL_SCENARIOS) {
        try {
          await m.setup(page);
          await snap(page, `modal-${m.name}`);
          console.log(`  modal/${m.name}`);
        } catch (e: any) {
          console.log(`  modal/${m.name} 실패: ${e?.message?.slice(0, 50)}`);
        }
      }
    }

    await page.close();
  }

  // 리포트 저장
  const reportPath = path.join(OUT_DIR, '_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    minor: issues.filter(i => i.severity === 'minor').length,
    issues,
  }, null, 2));

  console.log('\n' + '='.repeat(72));
  console.log(`Total: ${issues.length} issues`);
  console.log(`  Critical: ${issues.filter(i => i.severity === 'critical').length}`);
  console.log(`  Warning:  ${issues.filter(i => i.severity === 'warning').length}`);
  console.log(`  Minor:    ${issues.filter(i => i.severity === 'minor').length}`);
  console.log('='.repeat(72));
  console.log(`스크린샷: ${OUT_DIR}/`);
  console.log(`리포트: ${reportPath}`);

  await browser.close();
})();
