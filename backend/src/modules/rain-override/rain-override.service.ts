import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
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
      this.logger.log(`🌧 구역 ${groupId} 비 감지 → 개폐기 강제 닫음`);
      await this.closeAllOpenersInZone(groupId, 'rain-detected');
    } else {
      this.userOverride.set(groupId, false);
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
    this.logger.log(`🙋 구역 ${groupId} 비 도중 사용자 제어 감지 → 자동 닫힘 일시 정지`);
    await this.activityLog.log({
      userId, userName: 'user',
      action: 'device.rain_override.user_skipped',
      targetType: 'device', targetId: deviceId,
      details: { menu: '비 감지 우회', groupId },
    });
    this.eventsGateway.broadcastRainOverride?.({ groupId, rainDetected: true, userOverride: true });
  }

  private async closeAllOpenersInZone(groupId: string, reason: string) {
    const ownerUserId = await this.getZoneOwnerUserId(groupId);
    if (!ownerUserId) return;

    const rows: Array<{ id: string }> = await this.dataSource.query(`
      SELECT d.id
      FROM devices d
      JOIN houses h ON h.id::text = d.house_id
      WHERE h.group_id = CAST($1 AS uuid)
        AND d.device_type = 'actuator'
        AND d.equipment_type IN ('opener_open', 'opener_close')
    `, [groupId]);

    for (const r of rows) {
      try {
        // opener_open=ON → close (pairedDeviceId 인터록 → 자동으로 닫기 ON, 열기 OFF 처리됨)
        // 가장 안전한 명령: opener_close 장치에 state=ON
        const dev = await this.devicesRepo.findOne({ where: { id: r.id } });
        if (!dev) continue;
        if (dev.equipmentType !== 'opener_close') continue; // close 장치만 직접 트리거
        await this.devicesService.controlDevice(
          dev.id, ownerUserId,
          [{ code: 'state', value: 'ON' }],
          undefined, 'rain-override',
        );
        await this.activityLog.log({
          userId: ownerUserId, userName: 'system',
          action: 'device.rain_override.close',
          targetType: 'device', targetId: dev.id,
          details: { menu: '비 감지 우회', groupId, reason },
        });
      } catch (err: any) {
        this.logger.warn(`rain-override close 실패 ${r.id}: ${err?.message}`);
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
