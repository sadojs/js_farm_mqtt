/**
 * 저장(또는 켜기) 전에 "같은 장치를 서로 반대로 움직일 수 있는 규칙"을 찾는다.
 *
 * 사용자는 이 목록을 보고 "저장하면 기존 규칙은 꺼진다"는 안내에 따라 저장 여부를 고른다.
 * (실행 중 충돌 팝업보다 먼저, 저장 시점에 알리기 위함)
 *
 * 판정:
 *  - 관수(irrigation) 규칙은 관수 스케줄러가 따로 다루므로 제외
 *  - 같은 장치(개폐기는 열림/닫힘 쌍을 하나로 본다)를 대상으로 해야 함
 *  - 두 규칙이 모두 "시간대 한정"이고 시간대가 겹치지 않으면 충돌 아님
 *  - 개폐기: 같은 개폐기를 움직이면 충돌 (온도 규칙은 열기·닫기를 모두 낸다)
 *  - 그 외 장치: 켜기/끄기 명령이 서로 다르거나, 한쪽이 센서 기준(켜고 끄기)을 쓰면 충돌
 */

export interface RuleLike {
  id?: string;
  name?: string;
  conditions: any;
  actions: any;
}

export interface DeviceLike {
  id: string;
  name: string;
  equipmentType?: string | null;
  pairedDeviceId?: string | null;
}

export interface TimeWindow { days: number[] | null; start: number; end: number }

const ALL_DAY: TimeWindow = { days: null, start: 0, end: 1440 };

export function isIrrigationRule(r: RuleLike): boolean {
  return r?.conditions?.type === 'irrigation';
}

export function targetIds(actions: any): string[] {
  const arr = Array.isArray(actions) ? actions : [actions];
  const ids = new Set<string>();
  for (const a of arr) {
    if (a?.targetDeviceId) ids.add(a.targetDeviceId);
    if (Array.isArray(a?.targetDeviceIds)) a.targetDeviceIds.forEach((x: string) => x && ids.add(x));
  }
  return [...ids];
}

function command(actions: any): 'on' | 'off' {
  const a = Array.isArray(actions) ? actions[0] : actions;
  return String(a?.command ?? 'on').toLowerCase() === 'off' ? 'off' : 'on';
}

function allConditions(conditions: any): any[] {
  return (conditions?.groups || []).flatMap((g: any) => g?.conditions || []);
}

/** 센서값으로 켜고 끄는(히스테리시스) 조건이 있는지 */
function usesSensorOnOff(conditions: any): boolean {
  return allConditions(conditions).some((c: any) =>
    (c?.type === 'sensor' || c?.type === 'weather') && Number(c?.deviation) > 0);
}

const isOpener = (d?: DeviceLike) => d?.equipmentType === 'opener_open' || d?.equipmentType === 'opener_close';

/** 개폐기는 열림/닫힘 쌍을 하나의 키로 */
export function deviceKey(d: DeviceLike): string {
  if (isOpener(d) && d.pairedDeviceId) return [d.id, d.pairedDeviceId].sort()[0];
  return d.id;
}

/** 시간 조건 하나 → 분 단위 구간들 (자정 넘김은 둘로 나눈다) */
function windowsOf(c: any): TimeWindow[] | null {
  const days = Array.isArray(c?.daysOfWeek) && c.daysOfWeek.length > 0 && c.daysOfWeek.length < 7
    ? c.daysOfWeek.map(Number) : null;
  const toMin = (v: number, minuteBased: boolean) => (minuteBased ? v : v * 60);
  const spans: Array<[number, number]> = [];
  if (Array.isArray(c?.timeSlots) && c.timeSlots.length > 0) {
    for (const s of c.timeSlots) {
      const st = Number(s.start), en = Number(s.end);
      spans.push([st < 24 ? st * 60 : st, en < 24 ? en * 60 : en]);
    }
  } else if (c?.operator === 'between' && Array.isArray(c?.value) && c.value.length === 2) {
    const minuteBased = c.field === 'time';
    spans.push([toMin(Number(c.value[0]), minuteBased), toMin(Number(c.value[1]), minuteBased)]);
  } else {
    return null; // 이상/이하 같은 열린 시간 조건은 하루 전체로 본다
  }
  const out: TimeWindow[] = [];
  for (const [s, e] of spans) {
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    if (s < e) out.push({ days, start: s, end: e });
    else if (s > e) { out.push({ days, start: s, end: 1440 }); out.push({ days, start: 0, end: e }); }
  }
  return out.length ? out : null;
}

/**
 * 규칙이 동작할 수 있는 시간대. 모든 조건 묶음이 AND 로 시간 조건을 포함할 때만 한정된다.
 * 그렇지 않으면(시간 제한 없음) 하루 전체.
 */
export function activeWindows(conditions: any): TimeWindow[] {
  const groups: any[] = conditions?.groups || [];
  if (groups.length === 0) return [ALL_DAY];
  const topAnd = (conditions?.logic ?? 'AND') === 'AND';
  const perGroup: (TimeWindow[] | null)[] = groups.map((g) => {
    if ((g?.logic ?? 'AND') !== 'AND') return null;
    const timeConds = (g?.conditions || []).filter((c: any) =>
      c?.type === 'time' || c?.field === 'time' || c?.field === 'hour');
    for (const tc of timeConds) {
      const w = windowsOf(tc);
      if (w) return w;
    }
    return null;
  });
  if (topAnd) {
    const limited = perGroup.find((w) => w);
    return limited ?? [ALL_DAY];
  }
  // OR: 어느 묶음이든 시간 제한이 없으면 하루 전체
  if (perGroup.some((w) => !w)) return [ALL_DAY];
  return perGroup.flat() as TimeWindow[];
}

function daysOverlap(a: number[] | null, b: number[] | null) {
  if (!a || !b) return true;
  return a.some((d) => b.includes(d));
}

export function windowsOverlap(a: TimeWindow[], b: TimeWindow[]): boolean {
  return a.some((x) => b.some((y) => daysOverlap(x.days, y.days) && x.start < y.end && y.start < x.end));
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function describeWindows(w: TimeWindow[]): string {
  if (w.length === 1 && w[0].start === 0 && w[0].end === 1440 && !w[0].days) return '하루 종일';
  return w.map((x) => `${hhmm(x.start)}~${x.end === 1440 ? '24:00' : hhmm(x.end)}`).join(', ');
}

export interface SaveConflict {
  ruleId: string;
  ruleName: string;
  deviceNames: string[];
  reason: string;
}

/**
 * candidate 와 충돌하는 기존(켜진) 규칙 목록.
 * devices: 두 규칙의 대상 장치 정보(id → 장치). 모르는 장치는 무시.
 */
export function findSaveConflicts(
  candidate: RuleLike,
  existing: RuleLike[],
  devices: Map<string, DeviceLike>,
): SaveConflict[] {
  if (isIrrigationRule(candidate)) return [];
  const keysOf = (r: RuleLike) => {
    const m = new Map<string, DeviceLike>();
    for (const id of targetIds(r.actions)) {
      const d = devices.get(id);
      if (d) m.set(deviceKey(d), d);
    }
    return m;
  };
  const mine = keysOf(candidate);
  if (mine.size === 0) return [];
  const myWin = activeWindows(candidate.conditions);
  const myCmd = command(candidate.actions);
  const mySensor = usesSensorOnOff(candidate.conditions);

  const out: SaveConflict[] = [];
  for (const other of existing) {
    if (!other.id || other.id === candidate.id || isIrrigationRule(other)) continue;
    const theirs = keysOf(other);
    const shared = [...mine.entries()].filter(([k]) => theirs.has(k)).map(([, d]) => d);
    if (shared.length === 0) continue;
    const otherWin = activeWindows(other.conditions);
    if (!windowsOverlap(myWin, otherWin)) continue;

    const opener = shared.some(isOpener);
    const opposite = opener || myCmd !== command(other.actions) || mySensor || usesSensorOnOff(other.conditions);
    if (!opposite) continue;

    const when = describeWindows(otherWin);
    const reason = opener
      ? `같은 개폐기를 움직입니다 (${when})`
      : `같은 장치를 켜고 끄는 시점이 겹칩니다 (${when})`;
    out.push({
      ruleId: other.id,
      ruleName: other.name || '이름 없는 규칙',
      deviceNames: shared.map((d) => d.name),
      reason,
    });
  }
  return out;
}
