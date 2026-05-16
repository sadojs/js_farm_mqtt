import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/edit4-${name}.png`, fullPage: false })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`PAGEERR: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE-ERR: ${m.text().slice(0, 200)}`) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', 'mtest')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {})

  await page.goto(`${BASE}/automation`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const card = page.locator('text=고온시 개폐기 자동 개방').first()
  await card.waitFor({ timeout: 4000 })
  await card.click()
  await page.waitForTimeout(1500)
  await shoot(page, '01-step1')

  // stepper 라벨 확인
  const stepNames = await page.locator('.step-name').allTextContents()
  console.log('stepper labels:', JSON.stringify(stepNames))
  // 기대: ["구역","장치","조건","확인"] (4단계)

  let nextBtn = page.locator('.btn-primary').filter({ hasText: '다음' }).first()
  // Step 1 → 2 (장치)
  if (await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(500)
  }
  await shoot(page, '02-step2-actuator')

  // Step 2 (장치) 라벨 확인
  const step2Title = await page.locator('.step-actuator h3, .step-actuator .step-title').textContent().catch(() => '')
  console.log('step2 title:', step2Title)

  // Step 2 → 3 (조건)
  if (await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(1500)
  }
  await shoot(page, '03-step3-condition')

  // Step 3 조건 단계 셀렉터 확인
  const sensorSelect = page.locator('.device-select').first()
  if (await sensorSelect.isVisible().catch(() => false)) {
    const opts = await sensorSelect.locator('option').allTextContents()
    const cur = await sensorSelect.inputValue()
    console.log('sensor select still here (per-condition):', JSON.stringify(opts))
    console.log('current sensor_device_id:', cur)
  }
  const fieldSelect = page.locator('.field-select').first()
  if (await fieldSelect.isVisible().catch(() => false)) {
    const opts = await fieldSelect.locator('option').allTextContents()
    const cur = await fieldSelect.inputValue()
    console.log('field options:', JSON.stringify(opts))
    console.log('current field:', cur)
  }
  // hysteresis 값
  const hy = page.locator('.value-input.small')
  if (await hy.count() >= 2) {
    console.log('base=', await hy.nth(0).inputValue(), ' deviation=', await hy.nth(1).inputValue())
  }

  // Step 3 → 4 (확인)
  if (await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(600)
  }
  await shoot(page, '04-step4-review')

  const reviewTitle = await page.locator('.modal-title').textContent().catch(() => '')
  console.log('current modal title:', reviewTitle)
  const saveBtn = page.locator('.btn-primary').filter({ hasText: /저장/ }).first()
  console.log('save button visible:', await saveBtn.isVisible())

  console.log('---errors (non-401)---')
  errors.filter(e => !e.includes('401')).slice(0, 10).forEach(e => console.log(e))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
