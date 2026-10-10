import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * TypeORM 엔티티가 없어 synchronize 로 생기지 않는 raw-SQL 테이블(작물관리)을 실제 마이그레이션 파일로 만든다.
 * 테스트 DB 에만 적용되며 운영 DB 와 무관하다.
 */
async function applyRawMigrations(ds: DataSource) {
  const [{ exists }] = await ds.query(`select to_regclass('public.crop_community_offsets') is not null as exists`);
  if (exists) return;
  const dir = path.join(__dirname, '../../database/migrations');
  for (const f of ['006_crop_management.sql', '007_crop_feature_settings.sql', '010_greenhouse_offset_default.sql']) {
    await ds.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}

/**
 * 결정적(고정 UUID·고정 시각) 테스트 픽스처.
 * - 농장1 소속 행의 id 는 '11111111-' 로, 농장2 는 '22222222-' 로 시작하고 이름에는 'F1-' / 'F2-' 가 붙는다.
 *   → 응답에 다른 농장 접두사가 섞이면 데이터가 새는 것(교차 오염)으로 판정할 수 있다.
 */
export const id = (farm: number | string, n: number) =>
  `${String(farm).repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const USERS = {
  admin: { id: 'aaaaaaaa-0000-4000-8000-000000000001', username: 'platform-admin', name: '플랫폼관리자', role: 'admin', parentUserId: null },
  admin2: { id: 'aaaaaaaa-0000-4000-8000-000000000002', username: 'platform-admin2', name: '플랫폼관리자2', role: 'admin', parentUserId: null },
  f1: { id: id(1, 1), username: 'f1admin', name: 'F1-농장주', role: 'farm_admin', parentUserId: null },
  f2: { id: id(2, 1), username: 'f2admin', name: 'F2-농장주', role: 'farm_admin', parentUserId: null },
  u1: { id: id(1, 2), username: 'f1user', name: 'F1-일반사용자', role: 'farm_user', parentUserId: id(1, 1) },
  f3inactive: { id: id(3, 1), username: 'f3inactive', name: 'F3-비활성', role: 'farm_admin', parentUserId: null },
} as const;

/** 테스트가 쓰거나 서비스가 지연 생성하는 테이블까지 포함해 매 파일 시작 시 비운다. */
const TABLES = [
  'zone_notes', 'gdd_batches', 'work_logs', 'work_task_types', 'payroll_advances', 'payroll_day_overrides',
  'payroll_deductions', 'payroll_settlements', 'payroll_workers', 'spray_events', 'spray_products',
  'spray_programs', 'spray_zones', 'activity_logs', 'sensor_data', 'weather_data', 'sensor_standby',
  'sensor_alerts', 'automation_logs', 'automation_rules', 'env_mappings', 'group_devices', 'devices',
  'gateway_onboard_devices', 'gateways', 'houses', 'house_groups', 'feature_settings', 'device_tokens',
  'refresh_tokens', 'users',
];

const T0 = '2026-01-15T00:00:00Z';

export async function seed(ds: DataSource) {
  await applyRawMigrations(ds);
  const existing: string[] = (
    await ds.query(`select table_name from information_schema.tables where table_schema='public'`)
  ).map((r: any) => r.table_name);
  const toTruncate = TABLES.filter((t) => existing.includes(t));
  await ds.query(`TRUNCATE ${toTruncate.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  for (const u of Object.values(USERS)) {
    await ds.query(
      `insert into users (id, username, password_hash, name, role, parent_user_id, status, created_at, updated_at)
       values ($1,$2,'x',$3,$4,$5,$6,$7,$7)`,
      [u.id, u.username, u.name, u.role, u.parentUserId, u.username === 'f3inactive' ? 'inactive' : 'active', T0],
    );
  }

  for (const f of [1, 2]) {
    const owner = id(f, 1);
    const P = `F${f}-`;
    const groupId = id(f, 10);
    const houseId = id(f, 20);
    const gwId = id(f, 30);
    const sensorId = id(f, 40);
    const fanId = id(f, 41);
    const openId = id(f, 42);
    const closeId = id(f, 43);
    const ruleId = id(f, 50);

    await ds.query(
      `insert into house_groups (id, user_id, name, display_order, created_at, updated_at) values ($1,$2,$3,0,$4,$4)`,
      [groupId, owner, `${P}1동`, T0],
    );
    await ds.query(
      `insert into houses (id, user_id, group_id, name, created_at, updated_at) values ($1,$2,$3,$4,$5,$5)`,
      [houseId, owner, groupId, `${P}하우스`, T0],
    );
    await ds.query(
      `insert into gateways (id, user_id, gateway_id, name, house_id, group_id, status, agent_status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,'offline','offline',$7,$7)`,
      [gwId, owner, `f${f}-gw`, `${P}게이트웨이`, houseId, groupId, T0],
    );
    const dev = (did: string, name: string, deviceType: string, equipmentType: string | null, paired: string | null) =>
      ds.query(
        `insert into devices (id, user_id, house_id, gateway_id, friendly_name, name, category, device_type, equipment_type,
           paired_device_id, opener_group_name, online, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$12)`,
        [did, owner, houseId, `f${f}-gw`, `${P}${name}`, `${P}${name}`, deviceType, deviceType, equipmentType, paired,
          paired ? `${P}개폐기` : null, T0],
      );
    await dev(sensorId, '온습도', 'sensor', null, null);
    await dev(fanId, '유동팬', 'actuator', 'fan', null);
    await dev(openId, '개폐기열림', 'actuator', 'opener_open', closeId);
    await dev(closeId, '개폐기닫힘', 'actuator', 'opener_close', openId);

    await ds.query(
      `insert into automation_rules (id, user_id, group_id, name, rule_type, enabled, conditions, actions, created_at, updated_at)
       values ($1,$2,$3,$4,'time',true,$5,$6,$7,$7)`,
      [ruleId, owner, groupId, `${P}환기룰`,
        JSON.stringify({ logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'time', field: 'time', operator: 'between', value: { start: '06:00', end: '07:00' } }] }] }),
        JSON.stringify({ targetDeviceId: fanId, targetDeviceIds: [fanId], action: 'on' }), T0],
    );
    await ds.query(
      `insert into automation_logs (id, rule_id, user_id, executed_at, success) values ($1,$2,$3,$4,true)`,
      [id(f, 51), ruleId, owner, '2026-01-15 01:00:00'],
    );
    await ds.query(
      `insert into sensor_alerts (id, user_id, device_id, device_name, sensor_type, alert_type, severity, message, created_at)
       values ($1,$2,$3,$4,'temperature','out_of_range','warning',$5,$6)`,
      [id(f, 60), owner, sensorId, `${P}온습도`, `${P}고온 경고`, T0],
    );
    for (let h = 0; h < 3; h++) {
      await ds.query(
        `insert into sensor_data (time, device_id, user_id, sensor_type, value, unit) values ($1,$2,$3,'temperature',$4,'°C')`,
        // sensor_data PK 는 time 단독 → 농장별로 초 단위를 달리해 충돌 방지
        [`2026-01-15T0${h}:00:0${f}Z`, sensorId, owner, 20 + f + h],
      );
    }
    await ds.query(
      `insert into weather_data (time, user_id, temperature, humidity) values ($1,$2,$3,60)`,
      [`2026-01-15T00:00:0${f}Z`, owner, 10 + f],
    );
    await ds.query(
      `insert into activity_logs (id, user_id, user_name, group_id, group_name, action, target_type, target_id, target_name, created_at)
       values ($1,$2,$3,$4,$5,'group.update','group',$4,$5,'2026-01-15 02:00:00')`,
      [id(f, 70), owner, `${P}농장주`, groupId, `${P}1동`],
    );
    await ds.query(
      `insert into spray_zones (id, user_id, group_id, name, transplant_date, created_at, updated_at) values ($1,$2,$3,$4,'2026-01-01',$5,$5)`,
      [id(f, 80), owner, groupId, `${P}방재구역`, T0],
    );
    await ds.query(
      `insert into spray_events (id, user_id, zone_id, date, pest, created_at, updated_at) values ($1,$2,$3,'2026-01-20',$4,$5,$5)`,
      [id(f, 81), owner, id(f, 80), `${P}진딧물`, T0],
    );
    await ds.query(
      `insert into payroll_workers (id, user_id, name, start_date, created_at, updated_at) values ($1,$2,$3,'2026-01-01',$4,$4)`,
      [id(f, 90), owner, `${P}일꾼`, T0],
    );
    await ds.query(
      `insert into work_task_types (id, user_id, label, display_order, created_at, updated_at) values ($1,$2,$3,0,$4,$4)`,
      [id(f, 100), owner, `${P}순지르기`, T0],
    );
    await ds.query(
      `insert into work_logs (id, user_id, zone_id, task_type_id, done_at, note, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$5,$5)`,
      [id(f, 101), owner, groupId, id(f, 100), T0, `${P}작업메모`],
    );
    await ds.query(
      `insert into gdd_batches (id, user_id, group_id, crop_type, seedling_type, sowing_date, notes, created_at, updated_at)
       values ($1,$2,$3,'tomato','plug','2026-01-01',$4,$5,$5)`,
      [id(f, 110), owner, groupId, `${P}배치`, T0],
    );
    await ds.query(
      `insert into zone_notes (id, user_id, zone_id, text, created_by_user, created_by_name, created_at, updated_at)
       values ($1,$2,$3,$4,$2,$5,$6,$6)`,
      [id(f, 120), owner, groupId, `${P}메모`, `${P}농장주`, T0],
    );
  }
}
