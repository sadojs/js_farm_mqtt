import { findSaveConflicts, activeWindows, windowsOverlap, DeviceLike } from '../src/modules/automation/rules/save-conflict';

/** 저장 전 충돌 확인 — 같은 장치를 반대로 움직일 수 있는 규칙 찾기 */
describe('저장 전 규칙 충돌 확인 (단위)', () => {
  const devices = new Map<string, DeviceLike>([
    ['open1', { id: 'open1', name: '1동 측창 열림', equipmentType: 'opener_open', pairedDeviceId: 'close1' }],
    ['close1', { id: 'close1', name: '1동 측창 닫힘', equipmentType: 'opener_close', pairedDeviceId: 'open1' }],
    ['fan1', { id: 'fan1', name: '유동팬', equipmentType: 'fan' }],
    ['fan2', { id: 'fan2', name: '환기팬', equipmentType: 'fan' }],
  ]);
  const temp = (value = 25, deviation = 2) => ({
    logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'sensor', field: 'temperature', operator: 'gte', value, deviation }] }],
  });
  const time = (start: string, end: string, days?: number[]) => {
    const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    return { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'time', field: 'time', operator: 'between', value: [m(start), m(end)], daysOfWeek: days }] }] };
  };
  const act = (ids: string[], command?: string) => ({ targetDeviceId: ids[0], targetDeviceIds: ids, ...(command ? { command } : {}) });

  it('같은 개폐기를 다른 쪽(닫힘) id 로 잡은 규칙도 충돌로 본다', () => {
    const out = findSaveConflicts(
      { conditions: temp(), actions: act(['open1']) },
      [{ id: 'r1', name: '야간 보온', conditions: time('18:00', '06:00'), actions: act(['close1']) }],
      devices,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: 'r1', ruleName: '야간 보온' });
    expect(out[0].reason).toContain('개폐기');
  });

  it('시간대가 겹치지 않는 시간 규칙끼리는 충돌이 아니다', () => {
    const out = findSaveConflicts(
      { conditions: time('08:00', '12:00'), actions: act(['open1']) },
      [{ id: 'r1', name: '오후', conditions: time('13:00', '17:00'), actions: act(['open1']) }],
      devices,
    );
    expect(out).toEqual([]);
  });

  it('요일이 겹치지 않으면 충돌이 아니고, 겹치면 충돌이다', () => {
    const mine = { conditions: time('08:00', '12:00', [1, 2]), actions: act(['fan1'], 'off') };
    expect(findSaveConflicts(mine, [{ id: 'r', conditions: time('09:00', '10:00', [3]), actions: act(['fan1']) }], devices)).toEqual([]);
    expect(findSaveConflicts(mine, [{ id: 'r', conditions: time('09:00', '10:00', [2]), actions: act(['fan1']) }], devices)).toHaveLength(1);
  });

  it('자정을 넘는 시간대도 겹침으로 판정한다', () => {
    const a = activeWindows(time('22:00', '02:00'));
    const b = activeWindows(time('01:00', '03:00'));
    expect(windowsOverlap(a, b)).toBe(true);
  });

  it('팬: 둘 다 시간으로 켜기만 하면 충돌 아님, 한쪽이 끄기면 충돌', () => {
    const on = { id: 'r1', name: 'A', conditions: time('08:00', '18:00'), actions: act(['fan1']) };
    expect(findSaveConflicts({ conditions: time('10:00', '12:00'), actions: act(['fan1']) }, [on], devices)).toEqual([]);
    expect(findSaveConflicts({ conditions: time('10:00', '12:00'), actions: act(['fan1'], 'off') }, [on], devices)).toHaveLength(1);
  });

  it('팬: 온도 기준(켜고 끄기) 규칙과 시간 규칙이 같은 팬이면 충돌', () => {
    const out = findSaveConflicts(
      { conditions: temp(28, 2), actions: act(['fan1']) },
      [{ id: 'r1', name: '시간 환기', conditions: time('08:00', '18:00'), actions: act(['fan1']) }],
      devices,
    );
    expect(out).toHaveLength(1);
  });

  it('다른 장치·자기 자신·관수 규칙은 제외', () => {
    const out = findSaveConflicts(
      { id: 'me', conditions: temp(), actions: act(['fan1']) },
      [
        { id: 'me', conditions: temp(), actions: act(['fan1']) },
        { id: 'other', conditions: temp(), actions: act(['fan2']) },
        { id: 'irr', conditions: { type: 'irrigation' }, actions: act(['fan1']) },
      ],
      devices,
    );
    expect(out).toEqual([]);
  });
});
