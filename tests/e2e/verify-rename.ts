// mtest로 로그인하여 장치명 수정 UI가 어디에 있고 작동하는지 확인
import { chromium } from 'playwright';

const BASE_URL = 'https://localhost:5176';
const OUT = '/tmp/sf-verify';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // mtest 로그인
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'mtest');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|$)/, { timeout: 8000 }).catch(() => {});

  // 1. /devices 페이지
  console.log('\n━━━ /devices 페이지 ━━━');
  await page.goto(`${BASE_URL}/devices`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/mtest-devices.png`, fullPage: false });
  const renameBtns = await page.locator('.btn-rename').count();
  const deviceCards = await page.locator('.opener-group-card, .device-card, [class*="card"]').count();
  const hasEmpty = await page.locator('text=/장치가 없습니다|등록된 장치|로딩|empty/i').count();
  console.log(`  ✎ rename 버튼: ${renameBtns}개`);
  console.log(`  카드: ${deviceCards}개`);
  console.log(`  빈 상태 메시지: ${hasEmpty}개`);

  // 2. /gateways/:id/env 페이지
  console.log('\n━━━ /gateways/{lgw-dev}/env Zigbee 탭 ━━━');
  await page.goto(`${BASE_URL}/gateways/46986887-8562-42f1-9bb8-9e2a6310c5c7/env`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // Zigbee 탭 클릭
  const zigbeeTab = page.locator('text=Zigbee 장치').first();
  if (await zigbeeTab.isVisible().catch(() => false)) {
    await zigbeeTab.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT}/mtest-gateway-env-zigbee.png`, fullPage: false });
  const editBtns = await page.locator('.btn-icon').filter({ hasText: '✏' }).count();
  console.log(`  ✏ edit 버튼: ${editBtns}개`);

  if (editBtns > 0) {
    // 첫 번째 ✏ 클릭하여 인라인 편집 시작
    await page.locator('.btn-icon').filter({ hasText: '✏' }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/mtest-rename-active.png`, fullPage: false });
    const inputVisible = await page.locator('.name-input').first().isVisible().catch(() => false);
    console.log(`  편집 모드 input: ${inputVisible}`);

    if (inputVisible) {
      await page.locator('.name-input').first().fill('농장관리자_테스트_수정');
      await page.locator('.btn-icon.btn-save').first().click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/mtest-rename-saved.png`, fullPage: false });
      // 알림 확인
      const successTxt = await page.locator('text=/저장 완료|성공|이름이 수정/').count();
      const errorTxt = await page.locator('text=/오류|실패|저장에 실패/').count();
      console.log(`  성공 알림: ${successTxt}, 오류 알림: ${errorTxt}`);

      // 원복
      await page.waitForTimeout(1500);
      const editAgain = page.locator('.btn-icon').filter({ hasText: '✏' }).first();
      if (await editAgain.isVisible().catch(() => false)) {
        await editAgain.click();
        await page.waitForTimeout(300);
        await page.locator('.name-input').first().fill('0xa4c1380b8b5e9df7');
        await page.locator('.btn-icon.btn-save').first().click().catch(() => {});
        await page.waitForTimeout(1500);
        console.log('  원복 완료');
      }
    }
  }

  // 3. /groups 페이지 — 구역명 수정
  console.log('\n━━━ /groups 페이지 — 구역명 ━━━');
  await page.goto(`${BASE_URL}/groups`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const renameGroupBtns = await page.locator('.btn-rename-group').count();
  console.log(`  구역명 ✎ 버튼: ${renameGroupBtns}개`);
  await page.screenshot({ path: `${OUT}/mtest-groups.png`, fullPage: false });

  await browser.close();
})();
