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

  // 구역관리 페이지에서 시간 룰 클릭 → AutomationEditModal 진입
  await page.goto(`${BASE}/groups`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const ruleCard = page.locator('text=야간 환풍기 가동').first()
  await ruleCard.waitFor({ timeout: 4000 })
  await ruleCard.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/sf-verify-part1/timeslot-01-default.png', fullPage: false })

  // "시간대 일정" 섹션이 사라졌는지 + opt-in 버튼이 보이는지
  const schedulerVisible = await page.locator('.time-scheduler').isVisible().catch(() => false)
  const optInBtn = await page.locator('button.btn-add-scheduler').isVisible().catch(() => false)
  console.log(`기본 상태:`)
  console.log(`  .time-scheduler 노출: ${schedulerVisible} (기대: false)`)
  console.log(`  + 시간대 일정 추가 (선택) 버튼: ${optInBtn} (기대: true)`)

  // opt-in 버튼 클릭
  if (optInBtn) {
    await page.locator('button.btn-add-scheduler').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/sf-verify-part1/timeslot-02-opted-in.png', fullPage: false })
    const nowVisible = await page.locator('.time-scheduler').isVisible().catch(() => false)
    const slots = await page.locator('.time-slot').count()
    console.log(`\nopt-in 후:`)
    console.log(`  .time-scheduler 노출: ${nowVisible} (기대: true)`)
    console.log(`  슬롯 개수: ${slots} (기대: 1)`)

    // 마지막 슬롯 삭제 가능 확인
    await page.locator('.time-slot .btn-remove').first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/sf-verify-part1/timeslot-03-after-delete.png', fullPage: false })
    const afterDeleteVisible = await page.locator('.time-scheduler').isVisible().catch(() => false)
    const optInBtnAgain = await page.locator('button.btn-add-scheduler').isVisible().catch(() => false)
    console.log(`\n마지막 슬롯 삭제 후:`)
    console.log(`  .time-scheduler 노출: ${afterDeleteVisible} (기대: false)`)
    console.log(`  + 시간대 일정 추가 버튼 재노출: ${optInBtnAgain} (기대: true)`)
  }

  await browser.close()
})().catch(e => { console.error(e?.message || e); process.exit(1) })
