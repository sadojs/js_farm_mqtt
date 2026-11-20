import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Device } from '../devices/entities/device.entity';
import { RainOverrideService } from '../rain-override/rain-override.service';
import { HighTempOverrideService } from './high-temp-override.service';
import { DeviceArbiterService, SOURCE_LABEL, ArbiterSource, wantLabel, Want } from './device-arbiter.service';
import { IrrigationSchedulerService } from './irrigation-scheduler.service';
import { isGatewayLatched } from '../../common/emergency/emergency-latch';

/**
 * 장치 제어 현황 — "지금 누가 이 장치를 움직이는가"를 우선순위 사다리로 보여 준다.
 *
 * 순서: 수동 조작 > 방재 > 고온 강제열림 > 비 감지 자동 닫힘 > 관수 타이머 > 자동제어 규칙 > 센서 끊김 시간표.
 * 비상 정지는 순위가 아니라 잠금(lock)으로 따로 표시한다.
 * 각 주체의 상태는 실제 동작 경로(장치 설정·비/고온 서비스·중재기 요청)에서 읽는다 — 화면 전용 계산을 따로 두지 않는다.
 */

export type LadderState = 'win' | 'lose' | 'idle' | 'na';

export interface LadderRow {
  source: Exclude<ArbiterSource, 'emergency'>;
  label: string;
  state: LadderState;
  /** 한 줄 설명 — 이기고 있으면 이유, 밀렸으면 무엇에 밀렸는지 */
  detail: string;
  want?: Want;
}

export interface ControlStatus {
  deviceId: string;
  deviceName: string;
  deviceClass: 'opener' | 'fan' | 'irrigation' | 'other';
  lock: { active: boolean; label: string } | null;
  winner: { source: string; label: string; detail: string } | null;
  manual: { active: boolean; until: string | null; releasable: boolean };
  ladder: LadderRow[];
  checkedAt: string;
}

const ORDER: Exclude<ArbiterSource, 'emergency'>[] = [
  'manual', 'protection', 'high_temp', 'rain', 'irrigation_timer', 'rule', 'backup_schedule',
];

const minsLeft = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));

@Injectable()
export class ControlStatusService {
  constructor(
    @InjectRepository(Device) private readonly devicesRepo: Repository<Device>,
    private readonly dataSource: DataSource,
    private readonly rain: RainOverrideService,
    private readonly highTemp: HighTempOverrideService,
    private readonly arbiter: DeviceArbiterService,
    private readonly irrigation: IrrigationSchedulerService,
  ) {}

  private async groupOf(device: Device): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT gd.group_id::text AS gid FROM group_devices gd WHERE gd.device_id = $1::uuid
       UNION ALL
       SELECT g.group_id::text FROM gateways g WHERE (g.id::text = $2 OR g.gateway_id = $2) AND g.group_id IS NOT NULL
       LIMIT 1`,
      [device.id, device.gatewayId ?? ''],
    );
    return rows[0]?.gid ?? null;
  }

  async getStatus(deviceId: string, userId: string | null): Promise<ControlStatus> {
    const device = await this.devicesRepo.findOne({ where: userId ? { id: deviceId, userId } : { id: deviceId } });
    if (!device) throw new NotFoundException('장비를 찾을 수 없습니다.');

    const et = device.equipmentType;
    const isOpener = et === 'opener_open' || et === 'opener_close';
    const deviceClass: ControlStatus['deviceClass'] = isOpener ? 'opener' : et === 'fan' ? 'fan' : et === 'irrigation' ? 'irrigation' : 'other';
    const deviceKey = isOpener && device.pairedDeviceId ? [device.id, device.pairedDeviceId].sort()[0] : device.id;

    // 개폐기는 열림/닫힘 쌍 중 어느 쪽에 수동·타이머가 걸려도 같은 장치로 본다
    const pair = isOpener && device.pairedDeviceId
      ? await this.devicesRepo.findOne({ where: { id: device.pairedDeviceId } })
      : null;
    const settingsList = [device.deviceSettings || {}, pair?.deviceSettings || {}] as any[];
    const groupId = await this.groupOf(device);

    const rows = new Map<LadderRow['source'], Omit<LadderRow, 'source' | 'label'> & { active: boolean }>();
    const set = (s: LadderRow['source'], v: { active: boolean; detail: string; want?: Want; applicable?: boolean }) =>
      rows.set(s, { active: v.active, detail: v.detail, want: v.want, state: v.applicable === false ? 'na' : 'idle' });

    // ── 수동 조작 (방재 타이머는 아래에서 따로) ──
    const now = Date.now();
    const manualS = settingsList.find((s) => s.userOverride && s.overrideReason !== 'protection');
    const chOv = device.deviceSettings?.channelOverrides as Record<string, { until?: string }> | undefined;
    const activeChannelTimers = chOv
      ? Object.entries(chOv).map(([k, v]) => [k, v?.until] as const).filter(([, until]) => until && new Date(until).getTime() > now) as Array<[string, string]>
      : [];
    let manualUntil: string | null = null;
    if (manualS) {
      const until = manualS.overrideUntil && new Date(manualS.overrideUntil).getTime() > now ? manualS.overrideUntil : null;
      manualUntil = until;
      const want: Want | undefined = manualS.overrideDirection === 'open' ? 'open'
        : manualS.overrideDirection === 'close' ? 'close'
        : manualS.overrideValue === true ? 'on' : manualS.overrideValue === false ? 'off' : undefined;
      set('manual', {
        active: true,
        want,
        detail: `${want ? wantLabel(want) + ' · ' : ''}${until ? `남은 시간 ${minsLeft(until)}분` : '해제할 때까지 유지'}`,
      });
    } else if (activeChannelTimers.length > 0) {
      const latest = activeChannelTimers.map(([, u]) => u).sort().pop()!;
      manualUntil = latest;
      set('manual', { active: true, want: 'on', detail: `밸브 ${activeChannelTimers.length}개 수동 타이머 · 남은 시간 ${minsLeft(latest)}분` });
    } else {
      set('manual', { active: false, detail: '없음' });
    }

    // ── 방재 (개폐기·유동팬만) ──
    const protS = settingsList.find((s) => s.overrideReason === 'protection' && s.overrideUntil && new Date(s.overrideUntil).getTime() > now);
    if (deviceClass === 'opener' || deviceClass === 'fan') {
      set('protection', protS
        ? { active: true, want: deviceClass === 'opener' ? 'close' : 'off', detail: `하우스 밀폐 · 남은 시간 ${minsLeft(protS.overrideUntil)}분` }
        : { active: false, detail: '꺼짐' });
    } else {
      set('protection', { active: false, detail: '이 장치와 관계없음', applicable: false });
    }

    // ── 고온 강제열림 · 비 감지 자동 닫힘 (개폐기만) ──
    if (deviceClass === 'opener' && groupId) {
      const ht = await this.highTemp.describe(groupId);
      const tempTxt = ht.temp != null ? `내부 온도 ${ht.temp.toFixed(1)}℃` : '내부 온도 값 없음';
      set('high_temp', !ht.enabled
        ? { active: false, detail: '설정 꺼짐' }
        : ht.active
          ? { active: true, want: 'open', detail: `${tempTxt} ≥ 기준 ${ht.threshold}℃ · 비가 와도 닫지 않음` }
          : { active: false, detail: `${tempTxt} (기준 ${ht.threshold}℃ 아래)` });

      const z = this.rain.getZoneState(groupId);
      const excluded = settingsList.some((s) => s.rainOverrideDisabled);
      if (excluded) set('rain', { active: false, detail: '이 개폐기는 비 감지 닫힘에서 제외됨' });
      else if (!z.rainDetected) set('rain', { active: false, detail: '비 감지 없음' });
      else if (z.userOverride) set('rain', { active: false, detail: '비 감지됨 · 수동 조작으로 닫힘 멈춤' });
      else set('rain', { active: true, want: 'close', detail: ht.active ? '비 감지됨' : '우적센서 비 감지 → 닫기' });
    } else {
      set('high_temp', { active: false, detail: '이 장치와 관계없음', applicable: false });
      set('rain', { active: false, detail: '이 장치와 관계없음', applicable: false });
    }

    // ── 관수 타이머 (관수 장비) ──
    if (deviceClass === 'irrigation') {
      const run = this.irrigation.getActiveByDevice(device.friendlyName);
      set('irrigation_timer', run
        ? { active: true, want: 'on', detail: `"${run.ruleName}" 관수 중 · ${minsLeft(new Date(run.estimatedEndAt).toISOString())}분 남음` }
        : { active: false, detail: '진행 중인 관수 없음' });
    } else {
      set('irrigation_timer', { active: false, detail: '이 장치와 관계없음', applicable: false });
    }

    // ── 자동제어 규칙 · 센서 끊김 시간표 (중재기 요청) ──
    const claims = this.arbiter.claimsFor(deviceKey);
    const ruleClaims = claims.filter((c) => c.source === 'rule');
    const backupClaims = claims.filter((c) => c.source === 'backup_schedule');
    set('rule', ruleClaims.length
      ? {
          active: true,
          want: ruleClaims[0].want,
          detail: ruleClaims.map((c, i) => `"${c.label}" ${wantLabel(c.want)}${i > 0 && c.want !== ruleClaims[0].want ? ' · 밀림' : ''}`).join(' / '),
        }
      : { active: false, detail: '지금 요청하는 규칙 없음' });
    set('backup_schedule', backupClaims.length
      ? { active: true, want: backupClaims[0].want, detail: `온습도계 끊김 · 월별 시간표로 ${wantLabel(backupClaims[0].want)}` }
      : { active: false, detail: deviceClass === 'opener' ? '센서 정상' : '이 장치와 관계없음', applicable: deviceClass === 'opener' });

    // ── 승자 결정: 위에서부터 처음 요청 중인 주체 ──
    let winnerIdx = -1;
    const ladder: LadderRow[] = ORDER.map((source, i) => {
      const r = rows.get(source)!;
      let state: LadderState = r.state;
      let detail = r.detail;
      if (r.active) {
        if (winnerIdx === -1) { winnerIdx = i; state = 'win'; }
        else {
          state = 'lose';
          detail = `${detail} · ${SOURCE_LABEL[ORDER[winnerIdx]]}에 밀림`;
        }
      }
      return { source, label: SOURCE_LABEL[source], state, detail, want: r.want };
    });

    const latched = isGatewayLatched(device.gatewayId);
    const win = winnerIdx >= 0 ? ladder[winnerIdx] : null;
    return {
      deviceId: device.id,
      deviceName: device.name,
      deviceClass,
      lock: latched ? { active: true, label: '비상 정지 중 — 해제할 때까지 수동 조작을 포함해 켜는 명령이 모두 막힙니다' } : null,
      winner: win ? { source: win.source, label: win.label, detail: win.detail } : null,
      manual: { active: !!rows.get('manual')?.active, until: manualUntil, releasable: !!rows.get('manual')?.active },
      ladder,
      checkedAt: new Date().toISOString(),
    };
  }
}
