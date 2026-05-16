/**
 * opener-actuator-label-i18n E2E 회귀 테스트
 * - EDIT 위저드 Step 2 (StepActuatorSelect) 카드 메타가 한국어로 표시되는지
 * - v2 CREATE 위저드 device-by-intent 단계도 동일
 */
import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/label-${name}.png`, fullPage: false })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', 'mtest')
  await page.fill('input[type="password"]', 'admin123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {})

  // === EDIT 위저드 (RuleWizardModal) - 자동제어 설정 메뉴 ===
  console.log('=== EDIT 위저드 (RuleWizardModal) Step 2 검증 ===')
  await page.goto(`${BASE}/automation`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const ruleCard = page.locator('text=고온시 개폐기 자동 개방').first()
  await ruleCard.waitFor({ timeout: 4000 })
  await ruleCard.click()
  await page.waitForTimeout(1500)

  // Step 1 → 2 (장치)
  let nextBtn = page.locator('.btn-primary').filter({ hasText: '다음' }).first()
  if (await nextBtn.isEnabled()) {
    await nextBtn.click()
    await page.waitForTimeout(700)
  }
  await shoot(page, '01-edit-step2-actuator')

  // 카드의 category(.category) 텍스트 수집 — 영문 'opener', 'fan' 이 안 보여야 함
  const metaTexts = await page.locator('.device-card .category').allTextContents()
  console.log('actuator card meta labels:', JSON.stringify(metaTexts))
  const hasEnglish = metaTexts.some(t => /^(opener|fan|irrigation|other)$/.test(t.trim()))
  console.log(`영문 라벨 노출 (실패 조건): ${hasEnglish}`)
  const hasKorean = metaTexts.some(t => /개폐기|환풍기|관수|기타/.test(t))
  console.log(`한국어 라벨 노출: ${hasKorean}`)

  // 모달 닫기
  await page.locator('.btn-close, button:has-text("취소")').first().click().catch(() => {})
  await page.waitForTimeout(500)

  console.log('\n=== v2 CREATE 위저드 (IntentWizardModal) StepDeviceByIntent 검증 ===')
  // 새 룰 만들기
  const addBtn = page.locator('.btn-add-rule, button:has-text("새 룰"), button:has-text("룰 만들기"), button:has-text("+ 자동")').first()
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click()
    await page.waitForTimeout(1000)
  }
  // intent → 개폐기 선택
  const openerIntent = page.locator('.iwm-container .intent-card:has-text("개폐기")').first()
  if (await openerIntent.isVisible().catch(() => false)) {
    await openerIntent.click()
    await page.waitForTimeout(1000)
    await shoot(page, '02-v2-device-by-intent')

    const v2Metas = await page.locator('.iwm-container .device-meta').allTextContents()
    console.log('v2 device card meta:', JSON.stringify(v2Metas))
    const v2HasEnglish = v2Metas.some(t => /^(opener|fan|irrigation|other)$/.test(t.trim()))
    const v2HasKorean = v2Metas.some(t => /개폐기|환풍기/.test(t))
    console.log(`v2 영문 라벨 노출 (실패 조건): ${v2HasEnglish}`)
    console.log(`v2 한국어 라벨 노출: ${v2HasKorean}`)
  } else {
    console.log('  v2 위저드 진입 못함 — opener intent 미노출')
  }

  await browser.close()
})().catch(e => { console.error(e?.message || e); process.exit(1) })
