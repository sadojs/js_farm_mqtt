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

  await page.goto(`${BASE}/automation`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  // 시간 기반 룰 카드를 클릭 (야간 환풍기 가동)
  const ruleCard = page.locator('text=야간 환풍기 가동').first()
  await ruleCard.waitFor({ timeout: 4000 })
  await ruleCard.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/sf-verify-part1/timefix-01-step1.png', fullPage: false })

  // Step 2 (장치) 통과 → Step 3 (조건)
  let nextBtn = page.locator('.btn-primary').filter({ hasText: '다음' }).first()
  if (await nextBtn.isEnabled()) { await nextBtn.click(); await page.waitForTimeout(700) }
  if (await nextBtn.isEnabled()) { await nextBtn.click(); await page.waitForTimeout(1500) }

  await page.screenshot({ path: '/tmp/sf-verify-part1/timefix-02-condition.png', fullPage: false })

  // field-select / time-input의 실제 너비/잘림 여부 측정
  const fieldSel = page.locator('.field-select').first()
  if (await fieldSel.isVisible()) {
    const sel = await fieldSel.evaluate(el => {
      const e = el as HTMLSelectElement
      const opt = e.options[e.selectedIndex]
      return {
        selectedValue: e.value,
        selectedText: opt?.text || '',
        offsetWidth: (el as HTMLElement).offsetWidth,
        scrollWidth: (el as HTMLElement).scrollWidth,
      }
    })
    console.log('field-select:', sel)
  }

  const timeInputs = page.locator('.value-input.time-input')
  const count = await timeInputs.count()
  console.log(`time-input count: ${count}`)
  for (let i = 0; i < count; i++) {
    const info = await timeInputs.nth(i).evaluate(el => ({
      value: (el as HTMLInputElement).value,
      offsetWidth: (el as HTMLElement).offsetWidth,
      scrollWidth: (el as HTMLElement).scrollWidth,
    }))
    console.log(`  time-input[${i}]:`, info)
  }

  await browser.close()
})().catch(e => { console.error(e?.message || e); process.exit(1) })
