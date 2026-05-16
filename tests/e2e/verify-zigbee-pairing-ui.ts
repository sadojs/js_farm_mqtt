import { chromium, Page } from 'playwright'
const BASE = 'https://localhost:5176'
const OUT = '/tmp/sf-verify-part1'

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/zb-${name}.png`, fullPage: false })
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

  // 게이트웨이 환경설정 페이지로 이동
  const GW_ID = '46986887-8562-42f1-9bb8-9e2a6310c5c7'
  await page.goto(`${BASE}/gateways/${GW_ID}/env`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shoot(page, '01-env-settings')

  // Zigbee 탭 클릭 — 탭은 버튼/role=tab 일 가능성
  const tabCandidates = ['button:has-text("Zigbee 장치")', '[role="tab"]:has-text("Zigbee")', '.tab:has-text("Zigbee")', 'a:has-text("Zigbee 장치")']
  for (const sel of tabCandidates) {
    const loc = page.locator(sel).first()
    if (await loc.isVisible().catch(() => false)) {
      await loc.click()
      await page.waitForTimeout(1000)
      break
    }
  }
  await shoot(page, '01b-zigbee-tab')

  // + Zigbee 스캔 버튼
  const scanBtn = page.locator('button:has-text("Zigbee 스캔"), button:has-text("+ Zigbee")').first()
  await scanBtn.waitFor({ timeout: 4000 })
  await scanBtn.click()
  await page.waitForTimeout(1500)
  await shoot(page, '02-scan-modal-opened')

  // 모달 안에 페어링 모드 섹션 확인
  const pairingSection = page.locator('.pairing-section').first()
  const pairingVisible = await pairingSection.isVisible().catch(() => false)
  console.log(`pairing section visible: ${pairingVisible}`)

  const startBtn = page.locator('button:has-text("페어링 모드 시작")').first()
  const startBtnVisible = await startBtn.isVisible().catch(() => false)
  console.log(`"페어링 모드 시작" button visible: ${startBtnVisible}`)

  // 현재 캐시 장치 개수
  const scanItems = page.locator('.scan-item')
  console.log(`current scan items shown: ${await scanItems.count()}`)

  // 페어링 모드 시작 클릭
  if (startBtnVisible) {
    await startBtn.click()
    await page.waitForTimeout(2000)
    await shoot(page, '03-permit-join-active')

    const counterBtn = page.locator('button:has-text("페어링 대기 중")').first()
    if (await counterBtn.isVisible().catch(() => false)) {
      const txt = await counterBtn.textContent()
      console.log(`counter text: ${txt}`)
    }
  }

  // 닫기 → 타이머 정리되는지
  await page.locator('button:has-text("닫기")').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await shoot(page, '04-modal-closed')

  console.log('---errors (non-401)---')
  errors.filter(e => !e.includes('401')).slice(0, 8).forEach(e => console.log(e))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
