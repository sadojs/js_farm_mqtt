/**
 * gateway-management-redesign 회귀 검증
 */
import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/gw-${name}.png`, fullPage: false })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`PAGEERR: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text().slice(0, 200)}`) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', 'admin')
  await page.fill('input[type="password"]', 'Sessadojs3535!@')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {})

  await page.goto(`${BASE}/gateways`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await shoot(page, '01-overview')

  // TC-01: 카드 N개 렌더
  const cardCount = await page.locator('.gateway-card').count()
  console.log(`TC-01: 카드 count = ${cardCount}`)

  // TC-02: 검색 "lgw"
  await page.locator('.search-input').fill('lgw')
  await page.waitForTimeout(400)
  await shoot(page, '02-search-lgw')
  const searchCount = await page.locator('.gateway-card').count()
  console.log(`TC-02: 검색 후 카드 count = ${searchCount}`)
  await page.locator('.search-input').fill('')

  // TC-03: 필터 칩 "정상"
  await page.locator('.chip:has-text("정상")').first().click()
  await page.waitForTimeout(400)
  await shoot(page, '03-filter-ok')
  const okCount = await page.locator('.gateway-card').count()
  console.log(`TC-03: 정상 필터 카드 count = ${okCount}`)
  await page.locator('.chip:has-text("전체")').first().click()

  // TC-04: 그룹화 "없음"
  await page.locator('.seg-btn:has-text("없음")').click()
  await page.waitForTimeout(400)
  await shoot(page, '04-group-none')
  const farmHeaderCount = await page.locator('.farm-group-header').count()
  console.log(`TC-04: 그룹화 없음 → 농장 헤더 count = ${farmHeaderCount} (기대 0)`)
  await page.locator('.seg-btn:has-text("농장")').click()
  await page.waitForTimeout(300)

  // TC-05: 케밥 → 편집
  const kebab = page.locator('.kebab-btn').first()
  await kebab.click()
  await page.waitForTimeout(300)
  await shoot(page, '05-kebab-open')
  const editItem = page.locator('.kebab-item:has-text("편집")').first()
  const editVisible = await editItem.isVisible()
  console.log(`TC-05: 케밥 → 편집 항목 노출 = ${editVisible}`)
  if (editVisible) {
    await editItem.click()
    await page.waitForTimeout(500)
    const editModalVisible = await page.locator('.modal:has-text("게이트웨이 편집")').isVisible().catch(() => false)
    console.log(`     편집 모달 노출 = ${editModalVisible}`)
    await page.locator('.modal-close').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  // TC-06: 케밥 → Pi 설치 명령
  await page.locator('.kebab-btn').first().click()
  await page.waitForTimeout(300)
  const piItem = page.locator('.kebab-item:has-text("Pi 설치 명령")').first()
  if (await piItem.isVisible()) {
    await piItem.click()
    await page.waitForTimeout(500)
    const piModalVisible = await page.locator('.modal-cmd').isVisible().catch(() => false)
    console.log(`TC-06: Pi 설치 명령 모달 노출 = ${piModalVisible}`)
    await shoot(page, '06-pi-modal')
    await page.locator('.modal-close').first().click().catch(() => {})
    await page.waitForTimeout(300)
  }

  // TC-07: 다크모드
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.documentElement.classList.add('dark')
  })
  await page.waitForTimeout(500)
  await shoot(page, '07-darkmode')

  console.log('\n--- errors (non-401) ---')
  errors.filter(e => !e.includes('401')).slice(0, 8).forEach(e => console.log(e))
  await browser.close()
})().catch(e => { console.error(e?.message || e); process.exit(1) })
