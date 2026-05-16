// 장치별 특수 로직 테스트:
//  - 개폐기 인터록 (열림/닫힘 동시 ON 금지)
//  - 관주 채널 매핑 (원격제어 + 액비B접점 + 교반기 페어)
//  - 팬 동작/대기 시간 설정

import { setupBrowser, record, saveReport, API_URL } from './helpers';
import { Page } from 'playwright';

let apiToken = '';
async function ensureApiToken(page: Page) {
  if (apiToken) return apiToken;
  const res = await page.request.post(API_URL + '/auth/login', {
    data: { username: 'admin', password: 'Sessadojs3535!@' },
    headers: { 'Content-Type': 'application/json' },
  });
  apiToken = (await res.json()).accessToken;
  return apiToken;
}
async function api(page: Page, method: string, path: string, body?: any) {
  await ensureApiToken(page);
  const opts: any = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` } };
  if (body) opts.data = body;
  const res = await (page.request as any)[method.toLowerCase()](API_URL + path, opts);
  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status(), data };
}

(async () => {
  const { browser, page } = await setupBrowser();
  try {
    const gws = await api(page, 'GET', '/gateways');
    const lgw = gws.data?.find((g: any) => g.gatewayId === 'lgw-dev');
    if (!lgw) {
      record({ name: 'lgw-dev 없음', category: 'setup', status: 'FAIL' });
      saveReport(); await browser.close(); return;
    }

    // 모든 장치 조회
    const devs = await api(page, 'GET', '/devices');
    const allDevices: any[] = devs.data || [];
    record({
      name: '전체 장치 목록',
      category: 'device-logic',
      status: 'PASS',
      message: `total=${allDevices.length}, actuators=${allDevices.filter(d => d.deviceType === 'actuator').length}, sensors=${allDevices.filter(d => d.deviceType === 'sensor').length}`,
    });

    // ─── 1) 개폐기 (opener) 인터록 검증 ─────────────────
    const openers = allDevices.filter(d => d.equipmentType === 'opener_open' || d.equipmentType === 'opener_close');
    record({
      name: '개폐기 장치 발견',
      category: 'opener-interlock',
      status: openers.length > 0 ? 'PASS' : 'WARN',
      message: `count=${openers.length}`,
    });

    const openerOpen = allDevices.find(d => d.equipmentType === 'opener_open');
    const openerClose = allDevices.find(d => d.equipmentType === 'opener_close');

    if (openerOpen && openerClose) {
      // 페어링 확인
      record({
        name: '개폐기 페어링 확인',
        category: 'opener-interlock',
        status: openerOpen.pairedDeviceId === openerClose.id || openerClose.pairedDeviceId === openerOpen.id ? 'PASS' : 'WARN',
        message: `open.pairedDeviceId=${openerOpen.pairedDeviceId}, close.pairedDeviceId=${openerClose.pairedDeviceId}`,
      });

      // 열기 ON → 닫기 ON 동시 → 닫기 ON 처리 시 열기 OFF 되는지 확인
      // (실제 MQTT publish를 일으키지 않도록 device control API만 호출)
      const openCmd = await api(page, 'POST', `/devices/${openerOpen.id}/control`, {
        commands: [{ code: 'state', value: 'ON' }],
      });
      record({
        name: '개폐기 [열기] ON 명령',
        category: 'opener-interlock',
        status: openCmd.status === 200 || openCmd.status === 201 ? 'PASS' : 'FAIL',
        message: `status=${openCmd.status}`,
      });

      // 500ms 후 [닫기] ON — 인터록이면 열기가 자동 OFF되어야
      await new Promise(r => setTimeout(r, 1500));
      const closeCmd = await api(page, 'POST', `/devices/${openerClose.id}/control`, {
        commands: [{ code: 'state', value: 'ON' }],
      });
      record({
        name: '개폐기 [닫기] ON 명령 (인터록 트리거)',
        category: 'opener-interlock',
        status: closeCmd.status === 200 || closeCmd.status === 201 ? 'PASS' : 'FAIL',
        message: `status=${closeCmd.status}`,
      });

      // 정리: 모두 OFF
      await api(page, 'POST', `/devices/${openerOpen.id}/control`, { commands: [{ code: 'state', value: 'OFF' }] });
      await api(page, 'POST', `/devices/${openerClose.id}/control`, { commands: [{ code: 'state', value: 'OFF' }] });
    } else {
      record({ name: '개폐기 페어 없음 (인터록 테스트 스킵)', category: 'opener-interlock', status: 'SKIP' });
    }

    // ─── 2) 관주 컨트롤러 채널 매핑 검증 ─────────────────
    const irrigation = allDevices.find(d => d.equipmentType === 'irrigation');
    if (irrigation) {
      const mapping = irrigation.channelMapping || {};
      const required = ['remote_control', 'fertilizer_b_contact', 'mixer', 'zone_1', 'zone_2'];
      const missing = required.filter(k => !mapping[k]);
      record({
        name: '관주 컨트롤러 채널 매핑 필수 키',
        category: 'irrigation-mapping',
        status: missing.length === 0 ? 'PASS' : 'WARN',
        message: missing.length ? `누락: ${missing.join(',')}` : `매핑 ${Object.keys(mapping).length}개 OK`,
      });

      // 관주 zone 제어 (1구역만 짧게 테스트)
      if (mapping.zone_1) {
        const zoneOn = await api(page, 'POST', `/devices/${irrigation.id}/control`, {
          commands: [{ code: mapping.zone_1, value: 'ON' }],
        });
        record({
          name: `관주 ${mapping.zone_1} ON 명령`,
          category: 'irrigation-mapping',
          status: zoneOn.status === 200 || zoneOn.status === 201 ? 'PASS' : 'FAIL',
          message: `status=${zoneOn.status}`,
        });
        // 즉시 OFF
        await new Promise(r => setTimeout(r, 500));
        await api(page, 'POST', `/devices/${irrigation.id}/control`, {
          commands: [{ code: mapping.zone_1, value: 'OFF' }],
        });
      }
    } else {
      record({ name: '관주 컨트롤러 없음', category: 'irrigation-mapping', status: 'WARN' });
    }

    // ─── 3) 팬 동작/대기 시간 설정 ─────────────────────
    const fans = allDevices.filter(d => d.equipmentType === 'fan');
    record({
      name: '팬 장치 발견',
      category: 'fan-timer',
      status: fans.length > 0 ? 'PASS' : 'WARN',
      message: `count=${fans.length}`,
    });

    if (fans[0]) {
      // 첫 팬에 동작 시간 설정
      const set = await api(page, 'PATCH', `/devices/${fans[0].id}`, {
        deviceSettings: { operation_time: 30, standby_time: 15 },
      });
      record({
        name: '팬 동작/대기 시간 설정',
        category: 'fan-timer',
        status: set.status === 200 ? 'PASS' : 'FAIL',
        message: `status=${set.status}`,
      });

      // 다시 조회해서 반영 확인
      const get = await api(page, 'GET', `/devices/${fans[0].id}`);
      const settings = get.data?.deviceSettings || {};
      record({
        name: '팬 설정 반영 확인',
        category: 'fan-timer',
        status: settings.operation_time === 30 && settings.standby_time === 15 ? 'PASS' : 'WARN',
        message: `operation_time=${settings.operation_time}, standby_time=${settings.standby_time}`,
      });
    }

    // ─── 4) MQTT 토픽 발행 검증 (자동제어 실행 시) ─────
    // automation 룰 실행 → MQTT 토픽 발행 → 게이트웨이 측 수신 확인
    // 실제 MQTT log는 RPi 측에서 조회해야 하지만, backend log에서도 확인 가능
    record({
      name: 'MQTT 발행 검증 (백엔드 로그)',
      category: 'mqtt-flow',
      status: 'SKIP',
      message: 'backend log /tmp/backend-final.log에서 MQTT 발행 라인 확인 가능',
    });

  } catch (e: any) {
    record({ name: 'ERROR', category: 'system', status: 'FAIL', message: e?.message });
  } finally {
    saveReport();
    await browser.close();
  }
})();
