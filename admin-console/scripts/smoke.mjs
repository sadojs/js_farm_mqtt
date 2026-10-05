/**
 * 콘솔 인프라 스모크 테스트 (읽기 전용 — 쓰기 동작 실행 안 함).
 * 사용: CONSOLE_USER=… CONSOLE_PASS=… node scripts/smoke.mjs
 * 자격증명은 환경변수로만 받는다(파일·로그에 기록하지 않음).
 */
import { chromium } from 'playwright'

const BASE = process.env.CONSOLE_URL || 'https://localhost:5175'
const USER = process.env.CONSOLE_USER
const PASS = process.env.CONSOLE_PASS
if (!USER || !PASS) { console.error('CONSOLE_USER / CONSOLE_PASS 환경변수가 필요합니다'); process.exit(2) }

const browser = await chromium.launch()
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
const apiLog = []
page.on('request', (r) => {
  const u = new URL(r.url())
  if (u.pathname.startsWith('/api/')) apiLog.push({ path: u.pathname, header: r.headers()['x-farm-context'] || null, at: page.url() })
})

await page.goto(BASE + '/login')
await page.fill('#c-login-id', USER)
await page.fill('#c-login-pw', PASS)
await page.click('button[type=submit]')
await page.waitForURL(BASE + '/', { timeout: 15000 })
await page.waitForTimeout(1500)
console.log('✓ 로그인 →', new URL(page.url()).pathname, '| 셸:', await page.locator('.c-side').count() ? 'O' : 'X')

// 농장 선택 → 농장 보기 대시보드(기존 화면 임베드)
await page.click('.c-farmpick')
await page.waitForSelector('.c-farmlist button')
const firstFarm = await page.locator('.c-farmlist button').first().innerText()
apiLog.length = 0
await page.locator('.c-farmlist button').first().click()
await page.waitForURL(/\/farm\/[^/]+\/dashboard/, { timeout: 10000 })
await page.waitForTimeout(3000)
const farmId = new URL(page.url()).pathname.split('/')[2]
const legacyH2 = await page.locator('.legacy-scope h2').first().innerText().catch(() => '(없음)')
console.log(`✓ 농장 보기: ${firstFarm.split('\n')[0]} (${farmId}) | 기존 화면 제목: ${legacyH2} | 컨텍스트 바: ${await page.locator('.c-ctxbar').count() ? 'O' : 'X'}`)
const farmCalls = apiLog.filter((c) => c.at.includes('/farm/'))
const withHeader = farmCalls.filter((c) => c.header === farmId)
console.log(`  농장 보기 중 API ${farmCalls.length}건 중 X-Farm-Context=${farmId} 부착 ${withHeader.length}건`)
console.log('  미부착(플랫폼 표식):', [...new Set(farmCalls.filter((c) => !c.header).map((c) => c.path))].join(', ') || '없음')

// 플랫폼 화면으로 이동 → 헤더 없어야 함
apiLog.length = 0
await page.click('a.c-link[href="/users"]')
await page.waitForURL(BASE + '/users')
await page.waitForTimeout(1500)
const leaked = apiLog.filter((c) => c.header)
console.log(`✓ 플랫폼 화면(/users) API ${apiLog.length}건, 헤더 부착 ${leaked.length}건 ${leaked.length ? '✗ ' + leaked.map((c) => c.path).join(',') : '(정상)'}`)

console.log(errors.length ? `✗ 브라우저 오류 ${errors.length}건:\n  ` + errors.join('\n  ') : '✓ 브라우저 오류 0건')
await browser.close()
