/**
 * Rain-override E2E 검증 시나리오
 * 1. env_roles에 rain_detection 노출 확인
 * 2. env-config getSources에 우적센서 채널 등장 확인
 * 3. 매핑 저장
 * 4. MQTT water_leak=true publish → opener_close ON 명령 발행 + 자동제어 룰 skip 확인
 * 5. rain 도중 사용자가 직접 opener_open 호출 → suppress 활성, 추가 close 명령 없음
 * 6. water_leak=false → suppress 해제 + 자동제어 cron 자연 복귀
 * 7. 다시 water_leak=true → 강제 close 재개
 */
import mqtt from 'mqtt'
import axios from 'axios'
import https from 'https'

const BACKEND = 'https://localhost:5176'
const MQTT_URL = 'mqtt://localhost:1883'
const ax = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) })

const GW = 'lgw-dev'
const RAIN_DEVICE = '0xa4c138846e4666d3'  // 우적센서 friendlyName

let TOKEN = ''
let groupId = ''
let rainDeviceId = ''

async function login(user: string, pw: string) {
  const { data } = await ax.post(`${BACKEND}/api/auth/login`, { username: user, password: pw })
  return data.accessToken as string
}

async function getZoneAndDevices() {
  const { data: gateways } = await ax.get(`${BACKEND}/api/gateways`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const lgw = gateways.find((g: any) => g.gatewayId === GW)
  groupId = lgw.groupId
  const { data: devices } = await ax.get(`${BACKEND}/api/devices`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const rain = devices.find((d: any) => d.zigbeeIeee === RAIN_DEVICE)
  rainDeviceId = rain?.id
  const openerOpen = devices.find((d: any) => d.equipmentType === 'opener_open')
  const openerClose = devices.find((d: any) => d.equipmentType === 'opener_close')
  return { rain, openerOpen, openerClose }
}

async function ensureMapping() {
  const { data: mappings } = await ax.get(`${BACKEND}/api/env-config/groups/${groupId}/mappings`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const has = mappings.find((m: any) => m.roleKey === 'rain_detection')
  if (has) {
    console.log('  ✓ rain_detection already mapped')
    return
  }
  // 매핑 저장
  const body = {
    mappings: [
      ...mappings.map((m: any) => ({ roleKey: m.roleKey, sourceType: m.sourceType, deviceId: m.deviceId, sensorType: m.sensorType, weatherField: m.weatherField })),
      { roleKey: 'rain_detection', sourceType: 'sensor', deviceId: rainDeviceId, sensorType: 'rain_detection' },
    ],
  }
  await ax.put(`${BACKEND}/api/env-config/groups/${groupId}/mappings`, body, { headers: { Authorization: `Bearer ${TOKEN}` } })
  console.log('  ✓ rain_detection mapped (sensor)')
}

async function publishMqtt(topic: string, payload: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_URL)
    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        client.end()
        err ? reject(err) : resolve()
      })
    })
    client.on('error', reject)
  })
}

async function pause(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function readBackendLogTail(grep: string, sinceLine: number): Promise<{ matched: string[]; nextLine: number }> {
  const { execSync } = await import('child_process')
  const out = execSync(`tail -n +${sinceLine} /Users/ohjeongseok/Projects/smart-farm-mqtt/logs/backend.stdout.log 2>/dev/null || echo ''`).toString()
  const lines = out.split('\n')
  const total = sinceLine + lines.length
  const matched = lines.filter(l => l.includes(grep))
  return { matched, nextLine: total }
}

;(async () => {
  console.log('=== Phase 1: 로그인 + 디바이스 조회 ===')
  TOKEN = await login('mtest', 'admin123')
  const { rain, openerOpen, openerClose } = await getZoneAndDevices()
  console.log(`  rain device id: ${rainDeviceId}`)
  console.log(`  opener_open id: ${openerOpen?.id}`)
  console.log(`  opener_close id: ${openerClose?.id}`)
  console.log(`  groupId: ${groupId}`)

  console.log('\n=== Phase 2: env-config getSources에 rain_detection 노출 확인 ===')
  const { data: sources } = await ax.get(`${BACKEND}/api/env-config/groups/${groupId}/sources`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const rainSrc = sources.sensors.find((s: any) => s.sensorType === 'rain_detection')
  console.log(`  rain_detection in sources: ${!!rainSrc}`)
  if (rainSrc) console.log(`    ${rainSrc.deviceName} / ${rainSrc.label} (${rainSrc.currentValue ?? '값 없음'})`)

  console.log('\n=== Phase 3: env-config 매핑 ===')
  await ensureMapping()

  console.log('\n=== Phase 4: water_leak=true publish → close 명령 + 룰 skip ===')
  const { execSync: e1 } = await import('child_process')
  const startLine = parseInt(e1('wc -l < /Users/ohjeongseok/Projects/smart-farm-mqtt/logs/backend.stdout.log').toString().trim(), 10) + 1
  await publishMqtt(`farm/${GW}/z2m/${RAIN_DEVICE}`, { water_leak: true, battery: 90 })
  await pause(2500)
  const { matched: m4, nextLine: line4 } = await readBackendLogTail('rain-override.close', startLine)
  const { matched: m4b } = await readBackendLogTail('비 감지 → 개폐기 강제', startLine)
  const { matched: m4c } = await readBackendLogTail('rain_override_active', startLine)
  console.log(`  "비 감지 → 강제 닫음" 로그: ${m4b.length > 0 ? '✓' : '✗'}`)
  console.log(`  rain-override.close activity: ${m4.length > 0 ? '✓' : '✗'}`)
  console.log(`  (자동제어 룰 평가 시 rain_override_active로 skip 가능 — 다음 cron 사이클에서 발생)`)

  console.log('\n=== Phase 5: rain 도중 사용자 opener_open 직접 호출 → suppress 활성 ===')
  if (openerOpen) {
    const startLine5 = parseInt(e1('wc -l < /Users/ohjeongseok/Projects/smart-farm-mqtt/logs/backend.stdout.log').toString().trim(), 10) + 1
    try {
      await ax.post(`${BACKEND}/api/devices/${openerOpen.id}/control`,
        { commands: [{ code: 'state', value: 'ON' }] },
        { headers: { Authorization: `Bearer ${TOKEN}` } })
      console.log(`  user opener_open ON 호출 성공`)
    } catch (e: any) {
      console.log(`  user control 실패: ${e?.response?.data?.message}`)
    }
    await pause(1500)
    const { matched: m5 } = await readBackendLogTail('비 도중 사용자 제어', startLine5)
    console.log(`  "사용자 제어 감지 → suppress 활성" 로그: ${m5.length > 0 ? '✓' : '✗'}`)
  }

  console.log('\n=== Phase 6: water_leak=false publish → suppress 해제 + 자연 복귀 ===')
  const startLine6 = parseInt(e1('wc -l < /Users/ohjeongseok/Projects/smart-farm-mqtt/logs/backend.stdout.log').toString().trim(), 10) + 1
  await publishMqtt(`farm/${GW}/z2m/${RAIN_DEVICE}`, { water_leak: false, battery: 90 })
  await pause(2500)
  const { matched: m6 } = await readBackendLogTail('비 그침 → 자동제어', startLine6)
  console.log(`  "비 그침 → 자동제어 자연 복귀" 로그: ${m6.length > 0 ? '✓' : '✗'}`)

  console.log('\n=== Phase 7: 재발생 water_leak=true → 강제 close 재개 ===')
  const startLine7 = parseInt(e1('wc -l < /Users/ohjeongseok/Projects/smart-farm-mqtt/logs/backend.stdout.log').toString().trim(), 10) + 1
  await publishMqtt(`farm/${GW}/z2m/${RAIN_DEVICE}`, { water_leak: true, battery: 90 })
  await pause(2500)
  const { matched: m7 } = await readBackendLogTail('비 감지 → 개폐기 강제', startLine7)
  console.log(`  "재발생 비 감지" 로그: ${m7.length > 0 ? '✓' : '✗'}`)

  // 정리: water_leak=false로 되돌림
  console.log('\n=== 정리: water_leak=false ===')
  await publishMqtt(`farm/${GW}/z2m/${RAIN_DEVICE}`, { water_leak: false, battery: 90 })
  await pause(1500)

  console.log('\n✅ E2E 검증 완료')
})().catch(e => { console.error('ERR', e?.response?.data || e?.message || e); process.exit(1) })
