'use strict';

/**
 * 폴백 관수 스케줄 실행기 — 서버 automation 관수룰을 오프라인에서 재현.
 *
 * 온라인 irrigation-scheduler.buildTimeline 과 동일 타임라인(구역 순차):
 *   구역 ON + (액비 활성 시)교반기 ON
 *   → 액비모터 ON(구역시간 - 액비시간 - 종료전대기) / OFF(구역시간 - 종료전대기)
 *   → 구역 OFF + 교반기 OFF → 대기시간 → 다음 구역
 * 교반기는 '액비 활성 + 채널 존재' 일 때만 동작(액상비료 용해 목적).
 *
 * 채널은 온보드 GPIO slotKey(zone_1..zone_4, mixer, fertilizer_motor)만. 서버 sync 단계에서
 * zone 번호→slotKey 변환 + 온보드/미활성 필터를 마친 스케줄만 내려온다.
 *
 * 발화: eval tick(기본 30초)마다 요일+startTime(HH:MM) 매칭 → 하루 1회.
 * mode 이탈(폴백→온라인) 시 cancelAll 로 예약 타이머 정리(온라인 스케줄러가 인계).
 * 각 구역 OFF 는 명시 타이머로 처리하며, 기존 irrigation.js 안전망(irrigationMaxRuntimeMinutes)이 병행.
 */

function hhmm(now) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
function dateKey(now) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function runTimeline(sched, store, relay, queue, state) {
  const zones = (sched.zones || []).filter((z) => z.channel && z.durationMin > 0);
  if (!zones.length) return;
  const fert = sched.fertilizer || {};
  const fertEnabled = fert.enabled !== false && fert.durationMin > 0 && !!fert.channel;
  const mixerCh = sched.mixer && sched.mixer.enabled ? sched.mixer.channel : null;

  const timers = [];
  const at = (ms, fn) => { timers.push(setTimeout(fn, ms)); };

  let offsetMs = 0;
  for (const zone of zones) {
    const zoneMs = zone.durationMin * 60000;
    const waitMs = (zone.waitMin || 0) * 60000;
    const mixerActive = !!(mixerCh && fertEnabled);
    const base = offsetMs;

    // 1) 구역 ON (+ 교반기 ON)
    at(base, () => {
      relay.setRelay(zone.channel, true, `fallback-irrigation-zone-${zone.channel}`);
      if (mixerActive) relay.setRelay(mixerCh, true, 'fallback-irrigation-mixer');
    });

    // 2) 액비모터 ON/OFF (온라인과 동일 offset)
    if (fertEnabled) {
      const fertStart = zoneMs - fert.durationMin * 60000 - (fert.preStopWaitMin || 0) * 60000;
      const fertEnd = zoneMs - (fert.preStopWaitMin || 0) * 60000;
      if (fertStart >= 0 && fertEnd > fertStart) {
        at(base + fertStart, () => relay.setRelay(fert.channel, true, 'fallback-irrigation-fertilizer'));
        at(base + fertEnd, () => relay.setRelay(fert.channel, false, 'fallback-irrigation-fertilizer-off'));
      }
    }

    // 3) 구역 OFF (+ 교반기 OFF)
    at(base + zoneMs, () => {
      relay.setRelay(zone.channel, false, `fallback-irrigation-zone-off-${zone.channel}`);
      if (mixerActive) relay.setRelay(mixerCh, false, 'fallback-irrigation-mixer-off');
    });

    offsetMs += zoneMs + waitMs;
  }

  // 세션 종료 처리(완료 타이머가 자신 포함 타이머 목록을 정리)
  at(offsetMs, () => {
    queue.enqueue({
      eventType: 'rule_fired',
      payload: { rule: 'irrigation-schedule-complete', ruleId: sched.ruleId },
      occurredAt: new Date().toISOString(),
    });
    state.irrigationTimers = (state.irrigationTimers || []).filter((t) => !timers.includes(t));
  });

  state.irrigationTimers = (state.irrigationTimers || []).concat(timers);
  queue.enqueue({
    eventType: 'rule_fired',
    payload: { rule: 'irrigation-schedule-start', ruleId: sched.ruleId, zones: zones.map((z) => z.channel) },
    occurredAt: new Date().toISOString(),
  });
}

function evaluate({ store, state, now, relay, queue }) {
  if (!store.config().irrigationEnabled) return;
  const schedules = store.irrigationSchedules();
  if (!schedules.length) return;
  if (!state.irrigationFired) state.irrigationFired = {};

  const cur = hhmm(now);
  const day = now.getDay();
  const dk = dateKey(now);

  for (const sched of schedules) {
    if (!Array.isArray(sched.days) || !sched.days.includes(day)) continue;
    if (sched.startTime !== cur) continue;
    const key = `${sched.ruleId}@${sched.startTime}`;
    if (state.irrigationFired[key] === dk) continue; // 오늘 이미 발화 — 재발화 방지
    state.irrigationFired[key] = dk;
    runTimeline(sched, store, relay, queue, state);
  }
}

/** 폴백 이탈/종료 시 예약된 관수 타이머 전부 취소(온라인 스케줄러가 인계). */
function cancelAll(state) {
  (state.irrigationTimers || []).forEach((t) => clearTimeout(t));
  state.irrigationTimers = [];
}

module.exports = { evaluate, cancelAll };
