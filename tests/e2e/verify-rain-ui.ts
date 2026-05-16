import { chromium } from 'playwright'
const BASE = 'https://localhost:5176'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', 'mtest')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {})

  // 구역 관리 페이지
  await page.goto(`${BASE}/groups`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: '/tmp/sf-verify-part1/rain-01-groups.png', fullPage: false })

  // 우적센서 카드 텍스트 확인
  const rainCard = page.locator('.sub-card:has-text("우적센서")').first()
  const visible = await rainCard.isVisible().catch(() => false)
  console.log(`우적센서 카드 visible: ${visible}`)
  if (visible) {
    const text = await rainCard.innerText()
    console.log('카드 내용:', text.replace(/\n+/g, ' / '))
  }

  // env-config 모달 (구역 헤더의 ⚙ 버튼)
  console.log('\n--- env-config 모달 ---')
  await page.locator('button.btn-icon[title="환경설정"]').first().click().catch(() => {})
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/sf-verify-part1/rain-02-envconfig.png', fullPage: false })
  // "비 감지" 행 노출 확인 (env_role)
  const rainRow = await page.locator('text=비 감지').count()
  console.log(`"비 감지" 행 개수: ${rainRow}`)
  // 우적센서 옵션 — select 안에 노출
  const rainOption = await page.locator('option:has-text("우적")').count()
  console.log(`select option "우적": ${rainOption}`)

  // 모달 본문 스크롤하여 비 감지 행 표시
  const modalBody = page.locator('.modal-body, .env-config-modal, [class*="modal"]').last()
  await modalBody.evaluate((el) => { el.scrollTop = el.scrollHeight }).catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/sf-verify-part1/rain-03-envconfig-rain-row.png', fullPage: true })

  await browser.close()
})().catch(e => { console.error(e?.message || e); process.exit(1) })
