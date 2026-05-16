import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/edit-${name}.png`, fullPage: false })
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
  await shoot(page, '01-list')

  // 생성된 "고온시 개폐기 자동 개방" 카드 클릭 — 첫 번째
  const card = page.locator('text=고온시 개폐기 자동 개방').first()
  await card.waitFor({ timeout: 4000 })
  await card.click()
  await page.waitForTimeout(1500)
  await shoot(page, '02-edit-step1-zone-selected')

  // EDIT 위저드는 legacy RuleWizardModal — 스테퍼 표시
  const stepper = page.locator('.stepper').first()
  const stepperVisible = await stepper.isVisible().catch(() => false)
  console.log(`stepper visible: ${stepperVisible}`)

  // Step 1 (구역) — 자동 선택되어 있어야 함, 다음 버튼 클릭
  let nextBtn = page.locator('.btn-primary').filter({ hasText: '다음' }).first()
  if (await nextBtn.isVisible() && await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(700)
  }
  await shoot(page, '03-edit-step2-sensors')

  // Step 2 (측정기) — 다음
  if (await nextBtn.isVisible() && await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(700)
  }
  await shoot(page, '04-edit-step3-actuator')

  // Step 3 (장치) — "개폐기 열기"가 사전 선택되어 있고, 개폐기 섹션이 노출되는지 확인
  const openerSection = page.locator('text=/개폐기$/').first()
  const openerVisible = await openerSection.isVisible().catch(() => false)
  console.log(`opener section visible: ${openerVisible}`)
  // 사전 선택 카운트
  const selectedCards = page.locator('.device-card.selected')
  const selectedCount = await selectedCards.count()
  console.log(`pre-selected device cards: ${selectedCount}`)

  if (await nextBtn.isVisible() && await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(1500)  // hydrate 대기
  }
  await shoot(page, '05-edit-step4-condition')

  // Step 4 (조건) — sensor_device_id, field 셀렉터, hysteresis UI 확인
  const sensorSelect = page.locator('.device-select').first()
  const sensorSelectVisible = await sensorSelect.isVisible().catch(() => false)
  console.log(`sensor device select visible: ${sensorSelectVisible}`)
  if (sensorSelectVisible) {
    const opts = await sensorSelect.locator('option').allTextContents()
    const selectedVal = await sensorSelect.inputValue()
    console.log(`  sensor select options: ${JSON.stringify(opts)}`)
    console.log(`  current sensor_device_id: ${selectedVal}`)
  }

  const fieldSelect = page.locator('.field-select').first()
  if (await fieldSelect.isVisible().catch(() => false)) {
    const opts = await fieldSelect.locator('option').allTextContents()
    const cur = await fieldSelect.inputValue()
    console.log(`  field select options: ${JSON.stringify(opts)}`)
    console.log(`  current field: ${cur}`)
  }

  // 히스테리시스 입력 확인
  const hysteresisInputs = page.locator('.value-input.small')
  const hyCount = await hysteresisInputs.count()
  console.log(`  hysteresis inputs found: ${hyCount}`)
  if (hyCount >= 2) {
    const baseVal = await hysteresisInputs.nth(0).inputValue()
    const devVal = await hysteresisInputs.nth(1).inputValue()
    console.log(`  base=${baseVal}, deviation=${devVal}`)
  }

  await shoot(page, '06-edit-step4-detail')

  // 단위 셀 표시 확인
  const unitTexts = await page.locator('.unit').allTextContents()
  console.log(`  unit texts: ${JSON.stringify(unitTexts.slice(0, 4))}`)

  // 한번 더 다음 (확인 단계)
  if (await nextBtn.isVisible() && await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(800)
  }
  await shoot(page, '07-edit-step5-review')

  console.log('---errors---')
  errors.slice(0, 10).forEach(e => console.log(e))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
