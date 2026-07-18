'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 폴백 룰 저장소. 서버에서 받은 rules/sync 메시지를 JSON 파일로 저장하고,
 * 메모리 캐시로 보관한다.
 *
 * 형식 (서버 sync 메시지와 동일):
 * {
 *   version: 3,
 *   config: { heartbeatTimeoutSeconds, openerEnabled, ... },
 *   schedule: [{ month, enabled, mode, openTime, closeTime }, ...]
 * }
 */

const DEFAULT_RULES = {
  version: 0,
  config: {
    heartbeatTimeoutSeconds: 300,
    recoveryGraceSeconds: 30,
    openerEnabled: true,
    openerRainOverride: true,
    irrigationEnabled: true,
    irrigationMaxRuntimeMinutes: 30,
    fertilizerEnabled: true,
    fanEnabled: false,
    fanTriggerType: 'temperature',
    fanOnTemp: 35,
    fanOffTemp: 28,
    // 개폐기 온습도 조건(primary) + 온습도계 stale 타임아웃. 미수신 시 월별 스케줄(backup) 사용.
    openerTriggerType: 'temperature',
    openerOnValue: 30,
    openerOffValue: 25,
    // 온습도계 보고주기(관찰 ~14분/840초)보다 넉넉히. 짧으면 매 주기 stale 오판 → primary↔backup flip-flop.
    sensorTimeoutSeconds: 1200,
    // 게이트웨이 공통 개폐기/팬 동작·대기 (서버 sync로 갱신)
    openerOperationSeconds: 30,
    openerStandbySeconds: 60,
    fanOperationMinutes: 50,
    fanStandbyMinutes: 10,
    // 무전압 접점 우적센서 (온보드 GPIO 직결). enabled 면 GPIO 를 감시하여
    // farm/{gw}/z2m/{friendlyName} 로 {rain} 발행 → 기존 우적 파이프라인 재사용.
    rainInput: { enabled: false, pin: 21, activeLow: true, friendlyName: 'rain_sensor' },
  },
  channelMapping: null,
  // 폴백 중 실행할 관수 스케줄(서버 automation 관수룰에서 동기화). 온보드 GPIO 관수만.
  // 형식: [{ ruleId, startTime:'HH:MM', days:[0-6], zones:[{channel,durationMin,waitMin}],
  //          mixer:{enabled}, fertilizer:{enabled,durationMin,preStopWaitMin} }]
  irrigationSchedules: [],
  schedule: [
    { month: 1, enabled: false, mode: 'time', openTime: null, closeTime: null },
    { month: 2, enabled: false, mode: 'time', openTime: null, closeTime: null },
    { month: 3, enabled: false, mode: 'time', openTime: null, closeTime: null },
    { month: 4, enabled: true,  mode: 'time', openTime: '09:00', closeTime: '17:00' },
    { month: 5, enabled: true,  mode: 'time', openTime: '08:00', closeTime: '18:00' },
    { month: 6, enabled: true,  mode: 'always-open' },
    { month: 7, enabled: true,  mode: 'always-open' },
    { month: 8, enabled: true,  mode: 'always-open' },
    { month: 9, enabled: true,  mode: 'always-open' },
    { month: 10, enabled: true,  mode: 'time', openTime: '08:00', closeTime: '18:00' },
    { month: 11, enabled: false, mode: 'time', openTime: '09:00', closeTime: '17:00' },
    { month: 12, enabled: false, mode: 'time', openTime: null, closeTime: null },
  ],
};

class RuleStore {
  constructor({ rulesPath }) {
    this.rulesPath = rulesPath;
    this.cache = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.rulesPath, 'utf-8');
      this.cache = JSON.parse(raw);
      console.log(`[RULE-STORE] 로드 완료 v${this.cache.version}`);
    } catch (err) {
      console.warn(`[RULE-STORE] ${this.rulesPath} 로드 실패 — 기본값 사용: ${err.code || err.message}`);
      this.cache = JSON.parse(JSON.stringify(DEFAULT_RULES));
      this.persist();
    }
  }

  applySync(payload) {
    if (!payload || typeof payload.version !== 'number') {
      throw new Error('invalid sync payload');
    }
    // version 단조증가 (이미 적용한 version 무시)
    if (this.cache && payload.version <= this.cache.version && this.cache.version !== 0) {
      console.log(`[RULE-STORE] 이미 적용된 v${payload.version} 무시`);
      return;
    }
    this.cache = {
      version: payload.version,
      config: { ...DEFAULT_RULES.config, ...(payload.config || {}) },
      channelMapping: payload.channelMapping || null,
      schedule: Array.isArray(payload.schedule) && payload.schedule.length
        ? payload.schedule
        : DEFAULT_RULES.schedule,
      irrigationSchedules: Array.isArray(payload.irrigationSchedules)
        ? payload.irrigationSchedules
        : [],
    };
    this.persist();
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.rulesPath), { recursive: true });
      fs.writeFileSync(this.rulesPath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[RULE-STORE] persist 실패: ${err.message}`);
    }
  }

  config() {
    return this.cache?.config ?? DEFAULT_RULES.config;
  }

  schedule() {
    return this.cache?.schedule ?? DEFAULT_RULES.schedule;
  }

  scheduleFor(month) {
    return this.schedule().find((s) => s.month === month) || null;
  }

  /** 폴백 관수 스케줄 배열 (없으면 []). */
  irrigationSchedules() {
    return this.cache?.irrigationSchedules ?? [];
  }

  version() {
    return this.cache?.version ?? 0;
  }

  /**
   * rpi-fallback-channel-sync: 채널 매핑 캐시 반환.
   * 매핑 없으면 null (cold boot 직후).
   */
  channelMapping() {
    return this.cache?.channelMapping ?? null;
  }

  /**
   * 카테고리별 채널명 배열.
   * @param category 'irrigation' | 'fertilizer' | 'fan' | 'opener_open' | 'opener_close'
   */
  getChannels(category) {
    const cm = this.channelMapping();
    if (!cm) return [];
    if (category === 'opener_open')  return (cm.opener?.open  || []).map(e => e.channel);
    if (category === 'opener_close') return (cm.opener?.close || []).map(e => e.channel);
    return (cm[category] || []).map(e => e.channel);
  }

  /**
   * 채널명 → {channel, pin, name} 매핑 조회. 없으면 null.
   */
  findMapping(channel) {
    const cm = this.channelMapping();
    if (!cm) return null;
    const all = [
      ...(cm.irrigation || []),
      ...(cm.fertilizer || []),
      ...(cm.fan || []),
      ...(cm.opener?.open || []),
      ...(cm.opener?.close || []),
    ];
    return all.find(e => e.channel === channel) || null;
  }
}

module.exports = RuleStore;
