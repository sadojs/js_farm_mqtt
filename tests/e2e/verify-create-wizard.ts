import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

async function clickInWizard(page: Page, selector: string) {
  return page.locator('.iwm-container').locator(selector).first().click()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`PAGEERR: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`CONSOLE-ERR: ${m.text().slice(0, 200)}`)
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', 'mtest')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {})
  console.log('1. logged in')

  await page.goto(`${BASE}/automation`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shoot(page, '01-automation-list')

  const triggers = [
    '.btn-add-rule', 'button:has-text("새 룰")', 'button:has-text("룰 만들기")',
    'button:has-text("+ 자동 제어")', 'button:has-text("자동 제어 추가")',
    'button:has-text("+ 새")', '.fab', 'button[title*="추가"]', 'button:has-text("+")',
  ]
  let wizardOpened = false
  for (const sel of triggers) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      await loc.click().catch(() => {})
      await page.waitForTimeout(800)
      if (await page.locator('.iwm-container').isVisible().catch(() => false)) {
        wizardOpened = true
        break
      }
    }
  }
  console.log(`2. wizard opened: ${wizardOpened}`)
  await shoot(page, '02-wizard-step-zone')
  if (!wizardOpened) {
    console.log('!! wizard 미진입 — Automation.vue 상위 버튼 셀렉터 확인 필요')
    await browser.close()
    process.exit(1)
  }

  // 구역이 1개면 자동 선택되어 intent 단계로 바로 진입
  await shoot(page, '03-wizard-after-zone')
  let next = page.locator('.btn-next')

  // Intent: 개폐기 — 자동 proceed
  await shoot(page, '04-wizard-step-intent')
  if (await page.locator('.iwm-container .intent-card:has-text("개폐기")').isVisible().catch(() => false)) {
    await clickInWizard(page, '.intent-card:has-text("개폐기")')
    await page.waitForTimeout(1200)
  }
  await shoot(page, '05-wizard-after-intent-opener')

  // 장치 선택
  await clickInWizard(page, '.device-card')
  await page.waitForTimeout(400)
  if (await next.isVisible() && await next.isEnabled()) {
    await next.click()
    await page.waitForTimeout(800)
  }
  await shoot(page, '06-wizard-step-timing-time')

  // 온습도 탭
  await clickInWizard(page, '.trigger-tab:has-text("온습도")')
  await page.waitForTimeout(2500)
  await shoot(page, '07-wizard-timing-temperature-tab')

  // 측정값 셀렉터
  const channelSelect = page.locator('.iwm-container .form-select').first()
  const visible = await channelSelect.isVisible()
  console.log(`3. channel select visible: ${visible}`)
  if (visible) {
    const opts = await channelSelect.locator('option').allTextContents()
    console.log('   options:', JSON.stringify(opts))
    const tempOptValue = await channelSelect.locator('option', { hasText: '온도' }).first().getAttribute('value').catch(() => null)
    if (tempOptValue) {
      console.log('   selecting temperature, value=', tempOptValue)
      await channelSelect.selectOption(tempOptValue)
      await page.waitForTimeout(500)
      await shoot(page, '08-wizard-channel-selected-temp')
    }
  }

  // 기준값
  const baseInput = page.locator('.iwm-container .num-input').first()
  if (await baseInput.isVisible()) {
    await baseInput.fill('28')
    await page.waitForTimeout(300)
  }
  await shoot(page, '09-wizard-temp-filled')

  const unitLabels = await page.locator('.iwm-container .unit-label').allTextContents()
  console.log('   unit labels:', JSON.stringify(unitLabels))
  const baseLabelText = await page.locator('.iwm-container .field-label').allTextContents()
  console.log('   labels:', JSON.stringify(baseLabelText.slice(0, 5)))

  // 다음 → review
  if (await next.isVisible() && await next.isEnabled()) {
    await next.click()
    await page.waitForTimeout(800)
  } else {
    console.log('   next disabled — canProceed false?')
  }
  await shoot(page, '10-wizard-review-or-still-timing')

  // 룰 이름 입력
  const nameInput = page.locator('.iwm-container input[type="text"]').first()
  if (await nameInput.isVisible().catch(() => false)) {
    const cur = await nameInput.inputValue()
    if (!cur) await nameInput.fill('테스트_개폐기_온도룰')
    await page.waitForTimeout(200)
  }
  await shoot(page, '11-wizard-review-named')

  // 저장
  const createBtn = page.locator('.btn-next').first()
  if (await createBtn.isVisible() && await createBtn.isEnabled()) {
    await createBtn.click()
    await page.waitForTimeout(2500)
  }
  await shoot(page, '12-after-save')

  console.log('---errors---')
  errors.slice(0, 12).forEach(e => console.log(e))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
