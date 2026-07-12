import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Device } from '../devices/entities/device.entity';
import { EnvMapping } from '../env-config/entities/env-mapping.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DevicesService } from '../devices/devices.service';

/**
 * 비 감지(우적) → 개폐기 강제 닫음 오버라이드 서비스.
 *
 * 상태 머신 (구역 단위):
 *   NORMAL ─(rain=true)→ RAIN_CLOSE  : 강제 close + close 명령
 *   RAIN_CLOSE ─(rain=false)→ NORMAL : suppress 클리어, 자동제어 cron 자연 복귀
 *   RAIN_CLOSE ─(user controlDevice)→ USER_OVERRIDE_DURING_RAIN
 *   USER_OVERRIDE_DURING_RAIN ─(rain=false)→ NORMAL (suppress 클리어)
 *   USER_OVERRIDE_DURING_RAIN ─(rain=true 유지)→ 사용자 의도 존중, close 안 함
 *
 * 비 종료 동작: Option B — 자동제어 룰 자연 재평가 (FR-07)
 */
@Injectable()
export class RainOverrideService {
  private readonly logger = new Logger(RainOverrideService.name);

  /** groupId → rain detected */
  private rainState = new Map<string, boolean>();
  /** groupId → 비 도중 사용자 직접 제어 발생 여부 (suppress) */
  private userOverride = new Map<string, boolean>();
  /**
   * groupId → 개폐기 닫힘 듀티사이클 상태.
   * 비 감지 유지 동안 operation_time(동작)/standby_time(대기) 주기로 닫힘 펄스를 반복 발행한다.
   * (자동제어 개폐기 듀티사이클과 동일 — 단발 펄스로는 모터가 완전 닫힘까지 못 가므로)
   */
  private closeCycles = new Map<string, {
    anchorMs: number; onSec: number; offSec: number;
    lastOnPhase: boolean | null; deviceIds: string[]; ownerUserId: string;
  }>();
  /** 동일 방향 최대 지속 시간 — 이 시간이면 완전 닫힘 → 펄스 정지(모터 마모 방지). 자동제어와 동일. */
  private readonly CLOSE_CYCLE_MAX_MS = 10 * 60 * 1000;

  constructor(
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    @InjectRepository(EnvMapping) private mappingRepo: Repository<EnvMapping>,
    @Inject(forwardRef(() => DevicesService)) private devicesService: DevicesService,
    private dataSource: DataSource,
    private eventsGateway: EventsGateway,
    private activityLog: ActivityLogService,
  ) {}

  @OnEvent('sensor.rain_detected')
  async handleRainSignalEvent(payload: { deviceId: string; rainDetected: boolean }) {
    return this.handleRainSignal(payload.deviceId, payload.rainDetected);
  }

  async handleRainSignal(rainDeviceId: string, rainDetected: boolean) {
    // 우적센서 device-level 비활성화 토글 — deviceSettings.rainOverrideDisabled=true면 무시
    // (오탐 방지 — 옆집 스프링쿨러 등으로 인한 잘못된 닫힘 방지)
    const sensorDev = await this.devicesRepo.findOne({ where: { id: rainDeviceId } });
    if ((sensorDev?.deviceSettings as any)?.rainOverrideDisabled) {
      this.logger.log(`🚫 우적센서 ${sensorDev?.name ?? rainDeviceId} 비활성화 상태 — 비 감지 이벤트 무시`);
      return;
    }
    const mappings = await this.mappingRepo.find({
      where: { deviceId: rainDeviceId, roleKey: 'rain_detection' },
    });
    if (mappings.length === 0) return;
    for (const m of mappings) await this.handleZoneRainChange(m.groupId, rainDetected);
  }

  private async handleZoneRainChange(groupId: string, rainDetected: boolean) {
    const prevRain = this.rainState.get(groupId) ?? false;
    this.rainState.set(groupId, rainDetected);
    if (prevRain === rainDetected) return;

    if (rainDetected) {
      this.userOverride.set(groupId, false); // 새 비 이벤트는 처음부터
      this.logger.log(`🌧 구역 ${groupId} 비 감지 → 개폐기 닫힘 사이클 시작`);
      await this.startCloseCycle(groupId, 'rain-detected');
    } else {
      this.userOverride.set(groupId, false);
      this.closeCycles.delete(groupId); // 비 그침 → 닫힘 사이클 종료
      this.logger.log(`☀ 구역 ${groupId} 비 그침 → 자동제어 자연 복귀`);
      const ownerId = await this.getZoneOwnerUserId(groupId);
      if (ownerId) {
        await this.activityLog.log({
          userId: ownerId, userName: 'system',
          action: 'device.rain_override.cleared',
          targetType: 'group', targetId: groupId,
          details: { menu: '비 감지 우회', reason: 'rain stopped' },
        });
      }
    }
    this.eventsGateway.broadcastRainOverride?.({
      groupId, rainDetected, userOverride: this.userOverride.get(groupId) ?? false,
    });
  }

  /** automation-runner: opener 룰 실행 전 호출 — true면 룰 skip */
  isOpenerRainOverridden(groupId: string | null | undefined): boolean {
    if (!groupId) return false;
    const rain = this.rainState.get(groupId) ?? false;
    const userOverridden = this.userOverride.get(groupId) ?? false;
    return rain && !userOverridden;
  }

  /** controlDevice: 사용자(자동제어 아닌) 호출 시 — suppress 활성화 */
  async markUserOverrideIfRaining(groupId: string | null | undefined, userId: string, deviceId: string) {
    if (!groupId) return;
    const rain = this.rainState.get(groupId) ?? false;
    if (!rain || this.userOverride.get(groupId)) return;
    this.userOverride.set(groupId, true);
    this.closeCycles.delete(groupId); // 사용자 우회 → 닫힘 사이클 정지
    this.logger.log(`🙋 구역 ${groupId} 비 도중 사용자 제어 감지 → 자동 닫힘 일시 정지`);
    await this.activityLog.log({
      userId, userName: 'user',
      action: 'device.rain_override.user_skipped',
      targetType: 'device', targetId: deviceId,
      details: { menu: '비 감지 우회', groupId },
    });
    this.eventsGateway.broadcastRainOverride?.({ groupId, rainDetected: true, userOverride: true });
  }

  /**
   * 비 감지 시 개폐기 닫힘 듀티사이클 시작.
   * opener_close 장치 + vent_group 헤더의 operation_time(동작)/standby_time(대기)를 읽어
   * 사이클 상태를 등록하고 즉시 첫 동작 펄스를 발행한다. 이후 tickCloseCycles cron이 반복.
   */
  private async startCloseCycle(groupId: string, reason: string) {
    const ownerUserId = await this.getZoneOwnerUserId(groupId);
    if (!ownerUserId) return;

    // 개폐기 동작/대기는 게이트웨이(Pi) 공통값(fallback_configs) 사용 — 장치별 아님.
    const rows: Array<{ id: string; on_sec: number; off_sec: number }> = await this.dataSource.query(`
      SELECT d.id,
             COALESCE(fc.opener_operation_seconds, 30) AS on_sec,
             COALESCE(fc.opener_standby_seconds, 60)   AS off_sec
      FROM devices d
      JOIN houses hs ON hs.id::text = d.house_id
      LEFT JOIN gateways g          ON g.id::text = d.gateway_id
      LEFT JOIN fallback_configs fc ON fc.gateway_id = g.gateway_id
      WHERE hs.group_id = CAST($1 AS uuid)
        AND d.device_type = 'actuator'
        AND d.equipment_type = 'opener_close'
    `, [groupId]);
    if (rows.length === 0) return;

    const onSec = Number(rows[0].on_sec) > 0 ? Number(rows[0].on_sec) : 30;
    const offSec = Number(rows[0].off_sec) > 0 ? Number(rows[0].off_sec) : 60;
    this.closeCycles.set(groupId, {
      anchorMs: Date.now(), onSec, offSec, lastOnPhase: null,
      deviceIds: rows.map(r => r.id), ownerUserId,
    });
    await this.activityLog.log({
      userId: ownerUserId, userName: 'system',
      action: 'device.rain_override.close',
      targetType: 'group', targetId: groupId,
      details: { menu: '비 감지 우회', reason, onSec, offSec },
    }).catch(() => undefined);
    // 즉시 첫 동작 펄스
    await this.pulseClose(groupId);
  }

  /** 닫힘 동작 펄스 1회 발행 — durationMs=onSec 로 gpio-agent가 동작시간 뒤 자동 OFF(대기). */
  private async pulseClose(groupId: string) {
    const cyc = this.closeCycles.get(groupId);
    if (!cyc) return;
    for (const id of cyc.deviceIds) {
      try {
        // opener_close 장치에 state=ON (pairedDeviceId 인터록 → 열기 OFF 자동 처리)
        await this.devicesService.controlDevice(
          id, cyc.ownerUserId,
          [{ code: 'state', value: 'ON' }],
          undefined, 'rain-override',
          cyc.onSec * 1000,  // 동작 펄스 시간(ms) — 이후 gpio-agent 자동 OFF
        );
      } catch (err: any) {
        this.logger.warn(`rain-override close pulse 실패 ${id}: ${err?.message}`);
      }
    }
    cyc.lastOnPhase = true;
  }

  /**
   * 개폐기 닫힘 듀티사이클 tick — 비 감지 유지 동안 동작(onSec)/대기(offSec) 주기로 닫힘 펄스 반복.
   * 각 사이클 동작구간 시작(off→on 전환)마다 새 펄스를 발행한다.
   */
  @Cron('*/10 * * * * *')
  async tickCloseCycles() {
    if (this.closeCycles.size === 0) return;
    const now = Date.now();
    for (const [groupId, cyc] of this.closeCycles) {
      const raining = this.rainState.get(groupId) === true;
      const overridden = this.userOverride.get(groupId) === true;
      // 비 그침 / 사용자 우회 / 최대시간(완전 닫힘) 초과 → 사이클 종료(정지, 닫힘 유지)
      if (!raining || overridden || now - cyc.anchorMs >= this.CLOSE_CYCLE_MAX_MS) {
        this.closeCycles.delete(groupId);
        continue;
      }
      const cycleSec = cyc.onSec + cyc.offSec;
      const cyclePos = Math.floor((now - cyc.anchorMs) / 1000) % cycleSec;
      const isOnPhase = cyclePos < cyc.onSec;
      if (isOnPhase && cyc.lastOnPhase !== true) {
        // 새 동작 구간 진입 → 닫힘 펄스 재발행
        await this.pulseClose(groupId);
      } else if (!isOnPhase) {
        cyc.lastOnPhase = false;
      }
    }
  }

  private async getZoneOwnerUserId(groupId: string): Promise<string | null> {
    const rows = await this.dataSource.query(`
      SELECT user_id::text AS user_id FROM house_groups WHERE id = CAST($1 AS uuid) LIMIT 1
    `, [groupId]);
    return rows[0]?.user_id ?? null;
  }

  getZoneState(groupId: string) {
    return {
      rainDetected: this.rainState.get(groupId) ?? false,
      userOverride: this.userOverride.get(groupId) ?? false,
    };
  }
}
