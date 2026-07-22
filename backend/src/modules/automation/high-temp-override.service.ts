import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventsGateway } from '../gateway/events.gateway';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { RainOverrideService } from '../rain-override/rain-override.service';

/**
 * 고온 무대기 강제열림 판정 (서버측).
 *
 * "비가 그쳤고(우적 해제) + 구역 내부 온도 ≥ 고온 임계값" 인 동안, 개폐기 온도 룰의
 * 동작/대기 듀티사이클을 무시하고 '열림'만 대기 없이 연속 발행하도록 automation-runner 가
 * 이 판정을 사용한다. (닫힘의 rain-override 와 대칭.)
 *
 * - 임계값/토글: 구역 환경설정(fallback_configs.high_temp_*), 구역 단위.
 * - 우선순위: 비(우적) > 고온. 비 감지 중이면 항상 false.
 * - 기본 OFF: highTempOverrideEnabled=false 면 즉시 false → 기존 개폐기 동작 그대로.
 */
@Injectable()
export class HighTempOverrideService {
  private readonly logger = new Logger(HighTempOverrideService.name);

  /** groupId → 현재 고온 오버라이드 활성 여부 (전환 감지/로그/브로드캐스트용) */
  private activeZones = new Map<string, boolean>();
  /** groupId → 구역 설정 캐시(TTL) — disabled 구역이 매 tick DB 조회하지 않도록 */
  private cfgCache = new Map<string, { cfg: { enabled: boolean; threshold: number | null } | null; exp: number }>();
  private readonly CFG_TTL_MS = 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly rainOverride: RainOverrideService,
    private readonly eventsGateway: EventsGateway,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * 구역의 고온 무대기 강제열림 활성 여부.
   * 조건: ①highTempOverrideEnabled ②비 아님(rain=false) ③구역 내부온도 ≥ 임계값.
   * 전환 시 activity_log + broadcast. enabled=false 면 즉시 false(기존 경로 무변화).
   */
  async isActive(groupId: string | null | undefined): Promise<boolean> {
    if (!groupId) return false;
    const cfg = await this.getZoneConfig(groupId);
    if (!cfg || !cfg.enabled || cfg.threshold == null) {
      await this.setState(groupId, false, null, cfg?.threshold ?? null);
      return false;
    }
    // 비(우적) 우선 — 비 감지 중이면 고온 오버라이드 안 함(닫힘 유지)
    if (this.rainOverride.getZoneState(groupId).rainDetected) {
      await this.setState(groupId, false, null, cfg.threshold);
      return false;
    }
    const temp = await this.getZoneTemperature(groupId);
    const active = temp != null && temp >= cfg.threshold;
    await this.setState(groupId, active, temp, cfg.threshold);
    return active;
  }

  /** 구역의 현재 고온 오버라이드 상태 (UI 초기 배지용) */
  getZoneState(groupId: string): { active: boolean } {
    return { active: this.activeZones.get(groupId) ?? false };
  }

  private async setState(groupId: string, active: boolean, temp: number | null, threshold: number | null) {
    const prev = this.activeZones.get(groupId) ?? false;
    if (prev === active) return;
    this.activeZones.set(groupId, active);
    this.eventsGateway.broadcastHighTempOverride?.({ groupId, active, temperature: temp, threshold });
    const ownerId = await this.getZoneOwnerUserId(groupId);
    if (ownerId) {
      await this.activityLog.log({
        userId: ownerId, userName: 'system',
        action: active ? 'device.high_temp_override.open' : 'device.high_temp_override.cleared',
        targetType: 'group', targetId: groupId,
        details: { menu: '고온 강제열림', temperature: temp, threshold },
      }).catch(() => undefined);
    }
    this.logger.log(active
      ? `🔥 구역 ${groupId} 고온 강제열림 시작 (온도 ${temp} ≥ ${threshold}°C)`
      : `🆗 구역 ${groupId} 고온 강제열림 해제 → 자동제어 복귀`);
  }

  private async getZoneConfig(groupId: string): Promise<{ enabled: boolean; threshold: number | null } | null> {
    const cached = this.cfgCache.get(groupId);
    const now = Date.now();
    if (cached && cached.exp > now) return cached.cfg;
    const rows = await this.dataSource.query(`
      SELECT fc.high_temp_override_enabled AS enabled, fc.high_temp_open_threshold AS threshold
      FROM devices d
      JOIN houses hs ON hs.id::text = d.house_id
      JOIN gateways g ON g.id::text = d.gateway_id
      JOIN fallback_configs fc ON fc.gateway_id = g.gateway_id
      WHERE hs.group_id = CAST($1 AS uuid)
      LIMIT 1
    `, [groupId]);
    const cfg = rows[0]
      ? {
          enabled: rows[0].enabled === true || rows[0].enabled === 't',
          threshold: rows[0].threshold == null ? null : Number(rows[0].threshold),
        }
      : null;
    this.cfgCache.set(groupId, { cfg, exp: now + this.CFG_TTL_MS });
    return cfg;
  }

  private async getZoneTemperature(groupId: string): Promise<number | null> {
    // 1) env role 'internal_temp' (구역 대표 내부온도)
    const roleRows = await this.dataSource.query(`
      SELECT (SELECT sd.value FROM sensor_data sd
              WHERE sd.device_id = em.device_id AND sd.sensor_type = em.sensor_type
              ORDER BY sd.time DESC LIMIT 1) AS value
      FROM env_mappings em
      WHERE em.group_id = CAST($1 AS uuid) AND em.role_key = 'internal_temp'
        AND em.source_type = 'sensor' AND em.device_id IS NOT NULL AND em.sensor_type IS NOT NULL
      LIMIT 1
    `, [groupId]);
    if (roleRows[0]?.value != null) return Number(roleRows[0].value);
    // 2) fallback: 구역 내 아무 temperature 센서 최신값
    const rows = await this.dataSource.query(`
      SELECT sd.value FROM sensor_data sd
      JOIN devices d ON d.id = sd.device_id
      LEFT JOIN houses h ON h.id::text = d.house_id
      WHERE sd.sensor_type = 'temperature'
        AND (d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = CAST($1 AS uuid))
             OR h.group_id = CAST($1 AS uuid))
      ORDER BY sd.time DESC LIMIT 1
    `, [groupId]);
    return rows[0]?.value != null ? Number(rows[0].value) : null;
  }

  private async getZoneOwnerUserId(groupId: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT user_id::text AS user_id FROM house_groups WHERE id = CAST($1 AS uuid) LIMIT 1`,
      [groupId],
    );
    return rows[0]?.user_id ?? null;
  }
}
