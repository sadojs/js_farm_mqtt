#!/usr/bin/env node
/**
 * 안전한 마이그레이션 러너 — 적용 이력을 schema_migrations 에 기록해 '미적용분만' 실행.
 *
 * 사용:
 *   node scripts/migrate.js                    # 미적용 마이그레이션 전부 적용
 *   node scripts/migrate.js --baseline-through=039
 *       # 기존 DB 채택용: 005~039 는 이미 적용된 것으로 '표시만'(실행 안 함) 하고,
 *       #   040 이상만 실제 적용. 최근 040~048 은 전부 idempotent 라 재실행해도 안전.
 *   node scripts/migrate.js --dry            # 무엇이 적용될지 미리보기(변경 없음)
 *
 * database/migrations/*.sql 을 파일명 숫자 프리픽스 순으로 실행.
 * DATABASE_URL 은 backend/.env 에서 읽음.
 */
const { Client } = require('pg');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'database', 'migrations');
const args = process.argv.slice(2);
const baselineArg = args.find((a) => a.startsWith('--baseline-through='));
const baselineThrough = baselineArg ? parseInt(baselineArg.split('=')[1], 10) : null;
const dry = args.includes('--dry');

const numOf = (f) => {
  const m = f.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
};

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL 이 설정되어 있지 않습니다 (backend/.env).');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => numOf(a) - numOf(b) || a.localeCompare(b));
  const applied = new Set(
    (await c.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
  );

  let ran = 0, baselined = 0, skipped = 0;
  for (const f of files) {
    if (applied.has(f)) { skipped++; continue; }

    if (baselineThrough != null && numOf(f) <= baselineThrough) {
      if (dry) { console.log('[dry] baseline(기적용 표시):', f); baselined++; continue; }
      await c.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      baselined++;
      console.log('baseline(기적용 표시, 실행 안 함):', f);
      continue;
    }

    if (dry) { console.log('[dry] 적용 예정:', f); ran++; continue; }
    const sql = fs.readFileSync(path.join(DIR, f), 'utf-8');
    try {
      await c.query(sql); // 파일 자체 트랜잭션(BEGIN/COMMIT) 포함 가능 → 그대로 실행
      await c.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      ran++;
      console.log('적용:', f);
    } catch (e) {
      console.error('실패:', f, '-', e.message);
      await c.end();
      process.exit(1);
    }
  }

  console.log(`\n완료 — 적용 ${ran}, baseline ${baselined}, 스킵(기적용) ${skipped}${dry ? ' (dry-run, 실제 변경 없음)' : ''}`);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
