import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvAlertSetting, EnvAlertItem, EnvAlertKey } from './env-alert-setting.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * 환경 경보 (검토 §7-9 ③) — 숫자가 오래 넘으면 알려 준다.
 * 순간적으로 튀는 값은 무시하고 지속 시간(기본 5분)을 넘길 때만 한 번 알리고,
 * 정상으로 돌아오면 한 번 더 알린다. 조건이 이어지는 동안은 되풀이하지 않는다.
 */

/** 이보다 오래된 값은 판단에 쓰지 않는다 (자동제어와 같은 기준) */
const MAX_AGE_MIN = Number(process.env.AUTOMATION_SENSOR_MAX_AGE_MIN) || 20;
export const DEFAULT_MINUTES = 5;

export const DEFAULT_ITEMS: EnvAlertItem[] = [
  { key: 'temp_high', enabled: true, threshold: 35, minutes: DEFAULT_MINUTES },
  { key: 'humidity_high', enabled: true, threshold: 90, minutes: DEFAULT_MINUTES },
  { key: 'soil_low', enabled: false, threshold: 20, minutes: DEFAULT_MINUTES },
];

interface Meta {
  label: string; icon: string; unit: string; dir: 'high' | 'low';
  /** 정상 복귀로 볼 여유 — 기준 근처에서 경보·복귀가 번갈아 나는 것을 막는다 */
  margin: number; badWord: string; advice: string; min: number; max: number;
}
export const META: Record<EnvAlertKey, Meta> = {
  temp_high: { label: '내부 온도', icon: '🌡', unit: '℃', dir: 'high', margin: 0.5, badWord: '높음', advice: '개폐기가 열려 있는지 확인해 주세요.', min: 0, max: 60 },
  humidity_high: { label: '내부 습도', icon: '💧', unit: '%', dir: 'high', margin: 2, badWord: '높음', advice: '환기 상태를 확인해 주세요.', min: 30, max: 100 },
  soil_low: { label: '토양 수분', icon: '🌱', unit: '%', dir: 'low', margin: 2, badWord: '낮음', advice: '관수 상태를 확인해 주세요.', min: 0, max: 100 },
};

interface Track { since: number | null; alertedAt: number | null }

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

@Injectable()
export class EnvAlertsService {
  private readonly logger = new Logger(EnvAlertsService.name);
  private readonly tracks = new Map<string, Track>();

  constructor(
    @InjectRepository(EnvAlertSetting) private readonly repo: Repository<EnvAlertSetting>,
    private readonly dataSource: DataSource,
    private readonly eventsGateway: EventsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  private async ownGroup(userId: string | null, groupId: string): Promise<{ id: string; name: string; userId: string }> {
    const rows = await this.dataSource.query(
      `SELECT id::text AS id, name, user_id::text AS "userId" FROM house_groups WHERE id = $1::uuid ${userId ? 'AND user_id::text = $2' : ''} LIMIT 1`,
      userId ? [groupId, userId] : [groupId],
    );
    if (!rows[0]) throw new NotFoundException('구역을 찾을 수 없습니다.');
    return rows[0];
  }

  /** 설정 조회 — 저장 전이면 기본값과 saved=false */
  async get(userId: string | null, groupId: string) {
    await this.ownGroup(userId, groupId);
    const row = await this.repo.findOne({ where: { groupId } });
    const items = DEFAULT_ITEMS.map((d) => ({ ...d, ...(row?.items?.find((i) => i.key === d.key) ?? {}) }));
    return {
      groupId,
      saved: !!row,
      channel: row?.channel ?? 'push',
      items: items.map((i) => ({ ...i, label: META[i.key].label, unit: META[i.key].unit, dir: META[i.key].dir })),
    };
  }

  async save(userId: string | null, groupId: string, body: { items?: Partial<EnvAlertItem>[]; channel?: string }) {
    const group = await this.ownGroup(userId, groupId);
    const items: EnvAlertItem[] = DEFAULT_ITEMS.map((d) => {
      const inc = body.items?.find((i) => i?.key === d.key) ?? {};
      const m = META[d.key];
      const threshold = inc.threshold != null ? Number(inc.threshold) : d.threshold;
      const minutes = inc.minutes != null ? Math.round(Number(inc.minutes)) : d.minutes;
      if (!Number.isFinite(threshold) || threshold < m.min || threshold > m.max) {
        throw new BadRequestException(`${m.label} 기준은 ${m.min}~${m.max}${m.unit} 사이로 입력해 주세요.`);
      }
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
        throw new BadRequestException('지속 시간은 1~180분 사이로 입력해 주세요.');
      }
      return { key: d.key, enabled: inc.enabled != null ? !!inc.enabled : d.enabled, threshold, minutes };
    });
    const channel = body.channel === 'center' ? 'center' : 'push';
    await this.repo.save(this.repo.create({ groupId, userId: group.userId, items, channel }));
    // 기준이 바뀌었으니 진행 중인 판정은 처음부터
    for (const k of Object.keys(META)) this.tracks.delete(`${groupId}:${k}`);
    return this.get(userId, groupId);
  }

  /** 구역의 현재 값 — 내부 온도·습도는 구역 대표 센서, 토양 수분은 구역 센서 평균 */
  async readValues(groupId: string): Promise<Record<EnvAlertKey, number | null>> {
    const role = async (roleKey: string) => {
      const r = await this.dataSource.query(
        `SELECT (SELECT sd.value FROM sensor_data sd
                 WHERE sd.device_id = em.device_id AND sd.sensor_type = em.sensor_type
                   AND sd.time > now() - make_interval(mins => ${MAX_AGE_MIN})
                 ORDER BY sd.time DESC LIMIT 1) AS value
         FROM env_mappings em
         WHERE em.group_id = $1::uuid AND em.role_key = $2 AND em.source_type = 'sensor'
           AND em.device_id IS NOT NULL AND em.sensor_type IS NOT NULL
         LIMIT 1`, [groupId, roleKey]);
      return r[0]?.value == null ? null : Number(r[0].value);
    };
    const soil = await this.dataSource.query(
      `SELECT avg(v) AS value FROM (
         SELECT DISTINCT ON (sd.device_id) sd.value AS v
         FROM sensor_data sd
         JOIN devices d ON d.id = sd.device_id
         LEFT JOIN gateways g ON g.id::text = d.gateway_id OR g.gateway_id = d.gateway_id
         WHERE sd.sensor_type = 'soil_moisture'
           AND sd.time > now() - make_interval(mins => ${MAX_AGE_MIN})
           AND (d.id IN (SELECT gd.device_id FROM group_devices gd WHERE gd.group_id = $1::uuid) OR g.group_id = $1::uuid)
         ORDER BY sd.device_id, sd.time DESC) t`, [groupId]);
    return {
      temp_high: await role('internal_temp'),
      humidity_high: await role('internal_humidity'),
      soil_low: soil[0]?.value == null ? null : Number(soil[0].value),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(now = Date.now()) {
    const rows = await this.repo.find();
    for (const row of rows) {
      try {
        await this.evaluate(row, now);
      } catch (err: any) {
        this.logger.warn(`[env-alert] 구역 ${row.groupId} 판정 실패: ${err?.message ?? err}`);
      }
    }
  }

  private async evaluate(row: EnvAlertSetting, now: number) {
    const active = (row.items ?? []).filter((i) => i.enabled);
    if (active.length === 0) return;
    const values = await this.readValues(row.groupId);
    let groupName: string | null = null;
    const nameOf = async () => groupName ??= (await this.dataSource.query(
      `SELECT name FROM house_groups WHERE id = $1::uuid`, [row.groupId]))[0]?.name ?? '구역';

    for (const item of active) {
      const m = META[item.key];
      const v = values[item.key];
      const id = `${row.groupId}:${item.key}`;
      const t = this.tracks.get(id) ?? { since: null, alertedAt: null };
      if (v == null) { this.tracks.set(id, t); continue; } // 값이 없으면 판단 보류
      const bad = m.dir === 'high' ? v >= item.threshold : v <= item.threshold;
      const recovered = m.dir === 'high' ? v < item.threshold - m.margin : v > item.threshold + m.margin;

      if (bad) {
        t.since ??= now;
        if (!t.alertedAt && now - t.since >= item.minutes * 60_000) {
          t.alertedAt = now;
          const mins = Math.round((now - t.since) / 60_000);
          await this.send(row, 'warning',
            `${m.icon} ${await nameOf()} ${m.label} ${m.badWord}`,
            `${fmt(v)}${m.unit}가 ${mins}분째 이어지고 있습니다. (기준 ${fmt(item.threshold)}${m.unit}) ${m.advice}`,
            item.key);
        }
      } else if (recovered) {
        if (t.alertedAt) {
          const mins = Math.max(1, Math.round((now - (t.since ?? t.alertedAt)) / 60_000));
          await this.send(row, 'info',
            `✔ ${await nameOf()} ${m.label} 정상 복귀`,
            `${fmt(v)}${m.unit}로 ${m.dir === 'high' ? '내려왔' : '올라왔'}습니다. 경보 지속 시간 ${mins}분.`,
            item.key);
        }
        t.since = null;
        t.alertedAt = null;
      }
      // 기준과 복귀 여유 사이: 지금 상태를 유지
      this.tracks.set(id, t);
    }
  }

  private async send(row: EnvAlertSetting, type: 'warning' | 'info', title: string, message: string, key: string) {
    this.logger.log(`[env-alert] ${title} — ${message}`);
    try { this.eventsGateway.sendNotification(row.userId, { type, title, message }); } catch { /* 무시 */ }
    if (row.channel !== 'push') return;
    try {
      await this.notifications.sendToFarm(row.userId, { title, body: message, data: { type: 'env_alert', key, groupId: row.groupId } });
    } catch (err: any) {
      this.logger.warn(`[env-alert] 푸시 실패: ${err?.message ?? err}`);
    }
  }

  /** 테스트용 */
  resetTracks() { this.tracks.clear(); }
}
