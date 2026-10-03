import { Client } from 'pg';
import { assertTestDatabase } from './env';

export default async function globalTeardown() {
  if (process.env.FARMSCOPE_KEEP_TEST_DB === '1') return; // 디버깅용
  const db = assertTestDatabase();
  const adminUrl = new URL(process.env.DATABASE_URL as string);
  adminUrl.pathname = '/postgres';
  const c = new Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  await c.end();
}
