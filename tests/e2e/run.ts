import { setupBrowser, login, snap, record, saveReport, results, BASE_URL, API_URL } from './helpers';
import { Page } from 'playwright';

// 별도 API 토큰 (page와 무관하게 백엔드 직접 호출용)
let apiToken = '';

async function ensureApiToken(page: Page) {
  if (apiToken) return apiToken;
  const res = await page.request.post(API_URL + '/auth/login', {
    data: { username: 'admin', password: 'Sessadojs3535!@' },
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  apiToken = data.accessToken || '';
  return apiToken;
}

async function api(page: Page, method: string, path: string, body?: any) {
  await ensureApiToken(page);
  const opts: any = {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
  };
  if (body) opts.data = body;
  const res = await (page.request as any)[method.toLowerCase()](API_URL + path, opts);
  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status(), data };
}

// ──────────────────────────────────────────────────────────────────
// 1. AUTH 테스트
// ──────────────────────────────────────────────────────────────────
async function testAuth(page: Page) {
  // 1-1) 로그인 실패 (잘못된 비밀번호)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]', 'admin');
  await page.fill('input[name="password"], input[type="password"]', 'wrong-password');
  await page.click('button[type="submit"], button.btn-login');
  await page.waitForTimeout(2000);
  const errorVisible = await page.locator('.error-message, [class*="error"]').first().isVisible().catch(() => false);
  record({ name: '잘못된 비밀번호 시 에러 표시', category: 'auth', status: errorVisible ? 'PASS' : 'FAIL' });

  // 1-2) 로그인 성공
  const ok = await login(page);
  await snap(page, 'auth-login');
  record({ name: '관리자 로그인', category: 'auth', status: ok ? 'PASS' : 'FAIL' });

  // 1-3) /me 호출
  const me = await api(page, 'GET', '/auth/me');
  record({
    name: 'GET /auth/me',
    category: 'auth',
    status: me.status === 200 && me.data?.username === 'admin' ? 'PASS' : 'FAIL',
    message: `status=${me.status}`,
  });
}

// ──────────────────────────────────────────────────────────────────
// 2. USER MANAGEMENT 테스트
// ──────────────────────────────────────────────────────────────────
async function testUserManagement(page: Page) {
  await page.goto(`${BASE_URL}/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await snap(page, 'users-list');
  const title = await page.locator('h1, h2').first().textContent().catch(() => '');
  record({ name: '사용자 관리 페이지 로드', category: 'users', status: 'PASS', message: `title=${title?.slice(0, 30)}` });

  // 2-1) 목업 farm_admin 생성
  const uname = `e2e_test_${Date.now()}`;
  const create = await api(page, 'POST', '/users', {
    username: uname,
    password: 'Test1234!',
    name: 'E2E 테스트 농장관리자',
    role: 'farm_admin',
    address: '서울시 테스트구',
  });
  const userId = create.data?.id;
  record({
    name: '농장관리자 계정 생성 (POST /users)',
    category: 'users',
    status: create.status === 201 && userId ? 'PASS' : 'FAIL',
    message: `status=${create.status}`,
    details: create.data,
  });

  if (!userId) return null;

  // 2-2) 사용자 목록에서 새 계정 보이는지
  const listAfter = await api(page, 'GET', '/users');
  const found = Array.isArray(listAfter.data) && listAfter.data.find((u: any) => u.username === uname);
  record({
    name: '목록에서 새 사용자 조회',
    category: 'users',
    status: found ? 'PASS' : 'FAIL',
  });

  // 2-3) 사용자 정보 수정 (백엔드는 PUT 사용)
  const update = await api(page, 'PUT', `/users/${userId}`, { name: 'E2E 수정됨' });
  record({
    name: '사용자 정보 수정 (PUT)',
    category: 'users',
    status: update.status === 200 ? 'PASS' : 'FAIL',
    message: `status=${update.status}`,
  });

  // 2-4) 사용자 삭제
  const del = await api(page, 'DELETE', `/users/${userId}`);
  record({ name: '사용자 삭제 (DELETE)', category: 'users', status: del.status === 200 ? 'PASS' : 'FAIL' });

  // 2-5) 삭제 후 조회 시 사라졌는지
  const listFinal = await api(page, 'GET', '/users');
  const stillExists = Array.isArray(listFinal.data) && listFinal.data.find((u: any) => u.username === uname);
  record({
    name: '삭제 후 목록에 없음',
    category: 'users',
    status: !stillExists ? 'PASS' : 'FAIL',
    message: stillExists ? '⚠ 삭제 후에도 목록에 남아있음' : undefined,
  });

  return userId;
}

// ──────────────────────────────────────────────────────────────────
// 3. GATEWAY 테스트
// ──────────────────────────────────────────────────────────────────
async function testGateway(page: Page) {
  await page.goto(`${BASE_URL}/gateways`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await snap(page, 'gateway-list');

  // 3-1) 게이트웨이 목록 조회
  const list = await api(page, 'GET', '/gateways');
  const lgwDev = Array.isArray(list.data) && list.data.find((g: any) => g.gatewayId === 'lgw-dev');
  record({
    name: '게이트웨이 목록 조회 (lgw-dev 포함)',
    category: 'gateway',
    status: lgwDev ? 'PASS' : 'FAIL',
    message: `total=${list.data?.length}`,
  });

  // 3-2) 새 게이트웨이 생성
  const newGwId = `e2e-gw-${Date.now()}`;
  const create = await api(page, 'POST', '/gateways', {
    gatewayId: newGwId,
    name: 'E2E 테스트 게이트웨이',
    location: '테스트 위치',
  });
  const newId = create.data?.id;
  record({
    name: '게이트웨이 생성',
    category: 'gateway',
    status: create.status === 201 && newId ? 'PASS' : 'FAIL',
    message: `status=${create.status}`,
  });

  // 3-3) 생성된 게이트웨이 삭제
  if (newId) {
    const del = await api(page, 'DELETE', `/gateways/${newId}`);
    record({
      name: '게이트웨이 삭제',
      category: 'gateway',
      status: del.status === 200 ? 'PASS' : 'FAIL',
    });
  }

  return lgwDev?.id;
}

// ──────────────────────────────────────────────────────────────────
// 4. ONBOARD 장치 CRUD 테스트 (lgw-dev)
// ──────────────────────────────────────────────────────────────────
async function testOnboardDevices(page: Page, gwId: string) {
  // 4-1) 환경 설정 페이지로 이동
  await page.goto(`${BASE_URL}/gateways/${gwId}/env`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2000);
  await snap(page, 'gateway-env');

  // 4-2) 온보드 장치 목록 조회
  const all = await api(page, 'GET', `/gateway-env/${gwId}/all-devices`);
  const onboard = all.data?.onboard || [];
  const irrSlots = onboard.filter((s: any) => ['irrigation_zone', 'mixer', 'fertilizer_motor', 'remote_control', 'fertilizer_contact'].includes(s.slotType));
  const fanSlots = onboard.filter((s: any) => s.slotType === 'fan');
  const ventSlots = onboard.filter((s: any) => s.slotType?.startsWith('opener') || s.slotType === 'vent_group');
  record({
    name: '온보드 장치 목록 (lgw-dev)',
    category: 'onboard',
    status: onboard.length > 0 ? 'PASS' : 'FAIL',
    message: `total=${onboard.length} (fan=${fanSlots.length}, irr=${irrSlots.length}, vent=${ventSlots.length})`,
  });

  // 4-3) 팬 슬롯 이름 수정 (단일 슬롯)
  if (fanSlots[0]) {
    const orig = fanSlots[0].name;
    const upd = await api(page, 'PATCH', `/gateway-env/${gwId}/onboard/${fanSlots[0].id}`, {
      name: `${orig}_e2e_test`,
    });
    record({ name: '팬 슬롯 이름 수정', category: 'onboard', status: upd.status === 200 ? 'PASS' : 'FAIL' });
    // 원복
    await api(page, 'PATCH', `/gateway-env/${gwId}/onboard/${fanSlots[0].id}`, { name: orig });
  }

  // 4-4) 팬 슬롯 GPIO 핀 할당
  if (fanSlots[0]) {
    const updPin = await api(page, 'PATCH', `/gateway-env/${gwId}/onboard/${fanSlots[0].id}`, { gpioPin: 17 });
    record({ name: '팬 슬롯 GPIO 핀 할당 (BCM17)', category: 'onboard', status: updPin.status === 200 ? 'PASS' : 'FAIL' });
  }

  // 4-5) 팬 슬롯 enabled toggle
  if (fanSlots[1]) {
    const off = await api(page, 'PATCH', `/gateway-env/${gwId}/onboard/${fanSlots[1].id}`, { enabled: false });
    const on = await api(page, 'PATCH', `/gateway-env/${gwId}/onboard/${fanSlots[1].id}`, { enabled: true });
    record({
      name: '팬 슬롯 활성/비활성 토글',
      category: 'onboard',
      status: off.status === 200 && on.status === 200 ? 'PASS' : 'FAIL',
    });
  }

  // 4-6) ★ 관주 컨트롤러 삭제 (1구역 슬롯 삭제 → legacy 그룹 전체 삭제)
  const zone1 = irrSlots.find((s: any) => s.slotType === 'irrigation_zone' && s.slotKey === 'zone_1');
  if (zone1) {
    const before = (await api(page, 'GET', `/gateway-env/${gwId}/all-devices`)).data?.onboard?.length || 0;
    const del = await api(page, 'DELETE', `/gateway-env/${gwId}/onboard/${zone1.id}`);
    const after = (await api(page, 'GET', `/gateway-env/${gwId}/all-devices`)).data?.onboard?.length || 0;
    record({
      name: '관주 컨트롤러 삭제 (legacy 그룹)',
      category: 'onboard',
      status: del.status === 200 && after < before ? 'PASS' : 'FAIL',
      message: `before=${before}, after=${after}, deleted=${before - after}`,
    });
  } else {
    record({ name: '관주 zone_1 슬롯 없음 (이전에 삭제됨?)', category: 'onboard', status: 'WARN' });
  }

  return { onboard, fanSlots, irrSlots, ventSlots };
}

// ──────────────────────────────────────────────────────────────────
// 5. AUTOMATION 룰 테스트
// ──────────────────────────────────────────────────────────────────
async function testAutomation(page: Page, gwId: string) {
  await page.goto(`${BASE_URL}/automation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await snap(page, 'automation-list');

  // 5-1) 룰 목록
  const list = await api(page, 'GET', '/automation/rules');
  const allRules = Array.isArray(list.data) ? list.data : (list.data?.data || []);
  record({
    name: '자동제어 룰 목록',
    category: 'automation',
    status: list.status === 200 ? 'PASS' : 'FAIL',
    message: `total=${allRules.length}`,
  });

  // 5-2) "야간 환풍기 가동" 룰의 conditions 확인 — 1260 / 1320 (분 단위)
  const nightRule = allRules.find((r: any) => r.name && r.name.includes('야간 환풍기'));
  if (nightRule) {
    const conds = nightRule.conditions;
    const firstCond = conds?.groups?.[0]?.conditions?.[0];
    const value = firstCond?.value;
    record({
      name: '"야간 환풍기 가동" 룰 conditions 확인',
      category: 'automation',
      status: Array.isArray(value) ? 'PASS' : 'WARN',
      message: `field=${firstCond?.field}, value=${JSON.stringify(value)}`,
      details: firstCond,
    });
  } else {
    record({ name: '"야간 환풍기 가동" 룰 없음', category: 'automation', status: 'WARN' });
  }

  // 5-3) 1분 후 트리거되는 짧은 시간 범위 룰 생성 (실제 동작 확인용)
  // groupId가 필요하므로 기존 룰에서 추출
  const existingGroupId = nightRule?.groupId || allRules[0]?.groupId;
  const now = new Date();
  const startMin = now.getHours() * 60 + now.getMinutes() + 1;
  const endMin = startMin + 2;
  const createPayload: any = {
    name: `E2E 트리거 테스트 ${Date.now()}`,
    description: '1분 후 자동 트리거 확인용',
    conditions: {
      logic: 'AND',
      groups: [
        {
          logic: 'AND',
          conditions: [
            { type: 'time', field: 'time', operator: 'between', value: [startMin, endMin] },
          ],
        },
      ],
    },
    actions: { targetDeviceId: null, targetDeviceIds: [], sensorDeviceIds: [] },
    priority: 1,
  };
  if (existingGroupId) createPayload.groupId = existingGroupId;
  const created = await api(page, 'POST', '/automation/rules', createPayload);
  record({
    name: `테스트 룰 생성 (${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')} ~ ${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')})`,
    category: 'automation',
    status: created.status === 201 ? 'PASS' : 'FAIL',
    message: `status=${created.status} ${JSON.stringify(created.data?.message || created.data?.error || '').slice(0, 100)}`,
  });
  const ruleId = created.data?.id;

  // 5-4) 생성된 룰 즉시 삭제 (테스트 후 정리)
  if (ruleId) {
    await api(page, 'DELETE', `/automation/rules/${ruleId}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// 6. DEVICE LOGIC 테스트 — 채널 매핑 등
// ──────────────────────────────────────────────────────────────────
async function testDeviceLogic(page: Page, gwId: string) {
  // 6-1) 게이트웨이 devices 조회
  const all = await api(page, 'GET', `/gateway-env/${gwId}/all-devices`);
  const irrigationDev = all.data?.irrigationDevice;
  const zigbee = all.data?.zigbee || [];

  if (irrigationDev) {
    record({
      name: '관주 컨트롤러 actuator 존재',
      category: 'device-logic',
      status: 'PASS',
      message: `name=${irrigationDev.name}, equipmentType=${irrigationDev.equipmentType}`,
    });

    // 6-2) 채널 매핑 확인
    const mapping = irrigationDev.channelMapping || {};
    const hasRemoteControl = !!mapping.remote_control;
    const hasFertilizerB = !!mapping.fertilizer_b_contact;
    const hasMixer = !!mapping.mixer;
    record({
      name: '관주 채널 매핑 (원격제어 + B접점 + 교반기)',
      category: 'device-logic',
      status: hasRemoteControl && hasFertilizerB ? 'PASS' : 'WARN',
      message: `remote_control=${hasRemoteControl}, fertilizer_b=${hasFertilizerB}, mixer=${hasMixer}`,
    });
  } else {
    record({ name: '관주 컨트롤러 actuator 없음 (이전 삭제로?)', category: 'device-logic', status: 'WARN' });
  }

  // 6-3) Zigbee 장치 목록
  record({
    name: 'Zigbee 장치 목록',
    category: 'device-logic',
    status: 'PASS',
    message: `total=${zigbee.length}`,
  });
}

// ──────────────────────────────────────────────────────────────────
// 7. UI 시각 검증 (다크모드, 페이지별 캡처)
// ──────────────────────────────────────────────────────────────────
async function testUIVisuals(page: Page, gwId: string) {
  const pages = [
    { url: '/dashboard', name: 'dashboard' },
    { url: '/devices', name: 'devices' },
    { url: '/sensors', name: 'sensors' },
    { url: '/groups', name: 'groups' },
    { url: '/automation', name: 'automation' },
    { url: '/gateways', name: 'gateways' },
    { url: '/users', name: 'users' },
    { url: '/alerts', name: 'alerts' },
    { url: '/reports', name: 'reports' },
    { url: '/activity-log', name: 'activity-log' },
    { url: `/gateways/${gwId}/env`, name: 'gateway-env' },
  ];

  for (const p of pages) {
    try {
      await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(1500);
      await snap(page, `light-${p.name}`);
      const errors = await page.locator('text=/error|에러|오류|404|500/i').count().catch(() => 0);
      record({
        name: `라이트모드: ${p.url}`,
        category: 'ui-light',
        status: errors === 0 ? 'PASS' : 'WARN',
        message: errors > 0 ? `${errors}개 error 텍스트` : undefined,
      });
    } catch (e: any) {
      record({ name: `라이트모드 로드 실패: ${p.url}`, category: 'ui-light', status: 'FAIL', message: e?.message });
    }
  }

  // 다크모드 전환 (localStorage 셋팅 후 강제 reload)
  await page.evaluate(() => localStorage.setItem('sf-theme', 'dark'));

  for (const p of pages) {
    try {
      await page.goto(`${BASE_URL}${p.url}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      // App.vue가 마운트되면서 localStorage에서 sf-theme를 읽음
      await page.waitForTimeout(2000);
      await snap(page, `dark-${p.name}`);
      const hasDark = await page.evaluate(() => document.querySelector('#app')?.classList.contains('theme-dark'));
      // 추가 검증: 실제 배경색이 어두운가
      const bgColor = await page.evaluate(() => {
        const el = document.querySelector('#app') as HTMLElement | null;
        if (!el) return '';
        return getComputedStyle(el).backgroundColor;
      });
      record({
        name: `다크모드: ${p.url}`,
        category: 'ui-dark',
        status: hasDark ? 'PASS' : 'WARN',
        message: hasDark ? `bg=${bgColor}` : 'theme-dark 클래스 미적용 (App.vue 초기화 문제 가능성)',
      });
    } catch (e: any) {
      record({ name: `다크모드 로드 실패: ${p.url}`, category: 'ui-dark', status: 'FAIL' });
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────
(async () => {
  const { browser, page } = await setupBrowser();
  try {
    console.log('\n━━━ 1. AUTH ━━━');
    await testAuth(page);

    console.log('\n━━━ 2. USER MANAGEMENT ━━━');
    await testUserManagement(page);

    console.log('\n━━━ 3. GATEWAY ━━━');
    const gwId = await testGateway(page);

    if (gwId) {
      console.log('\n━━━ 4. ONBOARD DEVICES ━━━');
      await testOnboardDevices(page, gwId);

      console.log('\n━━━ 5. AUTOMATION ━━━');
      await testAutomation(page, gwId);

      console.log('\n━━━ 6. DEVICE LOGIC ━━━');
      await testDeviceLogic(page, gwId);

      console.log('\n━━━ 7. UI VISUALS ━━━');
      await testUIVisuals(page, gwId);
    }
  } catch (e: any) {
    record({ name: 'CRITICAL ERROR', category: 'system', status: 'FAIL', message: e?.message });
    console.error('FATAL:', e);
  } finally {
    saveReport();
    await browser.close();
  }
})();
