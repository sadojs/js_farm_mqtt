/**
 * 화면 캡처 + 읽기 전용 점검 (쓰기 동작 실행 안 함 — 페이지 이동·목록 선택만).
 *
 * 사용:
 *   실서버(로컬 백엔드) : CONSOLE_USER=… CONSOLE_PASS=… node scripts/screenshots.mjs
 *   모의 API(자격증명 X) : MOCK=1 node scripts/screenshots.mjs
 *
 * - 로그인은 1회만 한다(/auth/login 은 60초 10회 제한).
 * - 폭 1440 / 1180 / 820 에서 주요 화면을 docs/screenshots/{폭}/ 에 저장.
 * - 각 화면의 브라우저 오류, 페이지 가로 스크롤 여부, X-Farm-Context 부착 경로를 표로 출력.
 * - MOCK=1 은 /api 를 아래 고정 데이터로 응답한다(실데이터 접근 없음). 소켓은 차단한다.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.CONSOLE_URL || 'https://localhost:5175'
const MOCK = process.env.MOCK === '1'
const USER = process.env.CONSOLE_USER
const PASS = process.env.CONSOLE_PASS
if (!MOCK && (!USER || !PASS)) { console.error('CONSOLE_USER / CONSOLE_PASS 환경변수 또는 MOCK=1 이 필요합니다'); process.exit(2) }

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots', MOCK ? 'mock' : 'live')
const WIDTHS = (process.env.WIDTHS || '1440,1180,820').split(',').map(Number)

// ── 모의 데이터 (가상의 농장 — 실제 계정·장치와 무관) ──
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const ADMIN = '00000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const old = new Date(Date.now() - 3600_000).toISOString()
const M = {
  me: { id: ADMIN, username: 'admin', name: '관리자', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: now },
  users: [
    { id: ADMIN, username: 'admin', name: '관리자', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: now },
    { id: F1, username: 'farm-a', name: '가나농장', role: 'farm_admin', status: 'active', address: '강원특별자치도 횡성군', createdAt: '2026-03-02T00:00:00Z', updatedAt: now },
    { id: F2, username: 'farm-b', name: '다라농장', role: 'farm_admin', status: 'active', address: '충청북도 청주시', createdAt: '2026-05-10T00:00:00Z', updatedAt: now },
    { id: 'u-1', username: 'worker1', name: '작업자1', role: 'farm_user', parentUserId: F1, parentUserName: '가나농장', status: 'active', createdAt: '2026-04-01T00:00:00Z', updatedAt: now },
    { id: 'u-2', username: 'worker2', name: '작업자2', role: 'farm_user', parentUserId: F1, parentUserName: '가나농장', status: 'inactive', createdAt: '2026-04-02T00:00:00Z', updatedAt: now },
  ],
  farms: [
    { id: F1, username: 'farm-a', name: '가나농장', status: 'active' },
    { id: F2, username: 'farm-b', name: '다라농장', status: 'active' },
  ],
  gateways: [
    { id: 'gw-1', userId: F1, gatewayId: 'mock-gw-01', name: '가나 1호', location: '횡성', rpiIp: '10.0.0.11', groupId: 'z-1', groupName: '1번 하우스', houseId: null, status: 'online', agentStatus: 'online', zigbeeStatus: 'online', tunnelPort: 22201, tunnelStatus: 'connected', tunnelLastSeen: now, lastSeen: now, createdAt: '2026-03-03T00:00:00Z' },
    { id: 'gw-2', userId: F2, gatewayId: 'mock-gw-02', name: '다라 1호', location: '청주', rpiIp: '10.0.0.12', groupId: null, groupName: null, houseId: null, status: 'offline', agentStatus: 'offline', zigbeeStatus: 'offline', tunnelPort: 22202, tunnelStatus: 'disconnected', tunnelLastSeen: old, lastSeen: old, createdAt: '2026-05-11T00:00:00Z' },
  ],
  groups: [
    { id: 'z-1', userId: F1, name: '1번 하우스', enableGroupControl: true, enableAutomation: true, iotEnabled: true, houses: [], devices: [], createdAt: now, updatedAt: now, ownerName: '가나농장', ownerUsername: 'farm-a' },
    { id: 'z-2', userId: F1, name: '2번 하우스', enableGroupControl: true, enableAutomation: true, iotEnabled: true, houses: [], devices: [], createdAt: now, updatedAt: now, ownerName: '가나농장', ownerUsername: 'farm-a' },
  ],
  devices: [
    { id: 'd-1', userId: F1, name: '1번 온습도', deviceType: 'sensor', online: true },
    { id: 'd-2', userId: F1, name: '2번 온습도', deviceType: 'sensor', online: false },
    { id: 'd-3', userId: F1, name: '8채널 컨트롤러', deviceType: 'actuator', online: true },
  ],
  fallback: (gid) => ({
    config: { gatewayId: gid, version: gid === 'mock-gw-01' ? 7 : 3, lastAppliedVersion: gid === 'mock-gw-01' ? 7 : 2, lastAppliedAt: old, heartbeatTimeoutSeconds: 1200 },
    schedule: null,
    status: { mode: 'online', lastHeartbeatSeenAt: now },
  }),
}

function mockResponse(method, path) {
  const p = path.replace(/^\/api/, '')
  if (p === '/auth/refresh') return { accessToken: 'mock-token' }
  if (p === '/auth/me') return M.me
  if (method !== 'GET') return {}
  if (p === '/users') return M.users
  if (p === '/users/farm-admins' || p === '/groups/farm-admins') return M.farms
  if (p === '/gateways') return M.gateways
  if (p === '/groups') return M.groups
  if (p === '/devices') return M.devices
  if (p === '/health') return { status: 'ok', mqtt: { connected: true } }
  if (p === '/crop-management/feature/all') return { [F1]: true, [F2]: false }
  if (/^\/features\/users\//.test(p)) return { work_log: { enabled: true, platformEnabled: true, userEnabled: true, lockedByAdmin: false }, spray_schedule: { enabled: false, platformEnabled: true, userEnabled: false, lockedByAdmin: false }, worker_payroll: { enabled: true, platformEnabled: true, userEnabled: true, lockedByAdmin: false } }
  if (/^\/features(\/me)?$/.test(p)) return {}
  if (/^\/gateway-env\/[^/]+\/all-devices$/.test(p)) return { onboard: [], zigbee: [], irrigationDevice: null }
  if (/^\/fallback-config\/[^/]+\/events$/.test(p)) return { data: [], total: 0, limit: 20, offset: 0 }
  if (/^\/fallback-config\/[^/]+\/mode$/.test(p)) return { mode: 'online' }
  const fo = p.match(/^\/fallback-config\/([^/]+)$/)
  if (fo) return M.fallback(decodeURIComponent(fo[1]))
  if (/notifications/.test(p)) return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }
  return []
}

const PAGES = [
  { key: 'overview', path: '/' },
  { key: 'users', path: '/users' },
  { key: 'farms', path: '/farms' },
  { key: 'gateways', path: '/gateways' },
  { key: 'gateway-env', path: '/gateways/{gw}/env' },
  { key: 'config-deploy', path: '/config-deploy' },
  { key: 'emergency-failover', path: '/emergency-failover' },
  { key: 'farm-dashboard', path: '/farm/{farm}/dashboard' },
  { key: 'farm-groups', path: '/farm/{farm}/groups' },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: WIDTHS[0], height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
const apiLog = []
page.on('request', (r) => {
  const u = new URL(r.url())
  if (u.pathname.startsWith('/api/')) apiLog.push({ path: u.pathname, header: r.headers()['x-farm-context'] || null })
})

if (MOCK) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const req = route.request()
    const body = mockResponse(req.method(), new URL(req.url()).pathname)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route((url) => url.pathname.startsWith('/socket.io/'), (route) => route.abort())
}

// 로그인 (실서버: 1회만) / 모의: refresh 성공으로 바로 세션 복원
if (MOCK) {
  await page.goto(BASE + '/')
} else {
  await page.goto(BASE + '/login')
  await page.fill('#c-login-id', USER)
  await page.fill('#c-login-pw', PASS)
  await page.click('button[type=submit]')
}
await page.waitForURL(BASE + '/', { timeout: 15000 })
await page.waitForSelector('.c-side')
await page.waitForTimeout(1200)

// 실제 id 로 경로 치환 (첫 게이트웨이 · 첫 농장)
let gwId = MOCK ? 'gw-1' : null
let farmId = MOCK ? F1 : null
if (!MOCK) {
  // 실서버: 목록 첫 행을 눌러(선택만, 쓰기 없음) URL 의 ?select= 에서 id 를 얻는다
  await page.goto(BASE + '/gateways'); await page.waitForTimeout(1500)
  await page.locator('.c-tbl tr.c-click').first().click().catch(() => {})
  gwId = new URL(page.url()).searchParams.get('select')
  await page.goto(BASE + '/farms'); await page.waitForTimeout(1500)
  await page.locator('.c-tbl tr.c-click').first().click().catch(() => {})
  farmId = new URL(page.url()).searchParams.get('select')
}

const results = []
for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 900 })
  mkdirSync(join(OUT, String(w)), { recursive: true })
  for (const pg of PAGES) {
    const path = pg.path.replace('{gw}', gwId || 'none').replace('{farm}', farmId || 'none')
    errors.length = 0
    apiLog.length = 0
    await page.goto(BASE + path)
    await page.waitForTimeout(2200)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const file = join(OUT, String(w), `${pg.key}.png`)
    await page.screenshot({ path: file, fullPage: true })
    const isFarm = path.startsWith('/farm/')
    const withHeader = apiLog.filter((c) => c.header).length
    const relevantErrors = MOCK ? errors.filter((e) => !/socket\.io|ERR_FAILED|net::/.test(e)) : errors
    results.push({
      width: w, page: pg.key, url: new URL(page.url()).pathname,
      hScroll: overflow > 1 ? `${overflow}px ✗` : '없음',
      api: apiLog.length,
      header: isFarm ? `${withHeader}/${apiLog.length}` : withHeader ? `✗ ${withHeader}건 부착` : '0 (정상)',
      errors: relevantErrors.length,
      firstError: relevantErrors[0] || '',
      noHeader: isFarm ? [...new Set(apiLog.filter((c) => !c.header).map((c) => c.path.replace(/^\/api/, '')))].join(' ') : '',
    })
  }
}
console.table(results)
console.log('저장 위치:', OUT)
await browser.close()
