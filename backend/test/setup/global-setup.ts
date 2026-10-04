import { Client } from 'pg';
import { assertTestDatabase } from './env';

/** 매 실행마다 일회용 테스트 DB 를 새로 만든다 (스키마는 앱 부팅 시 TypeORM synchronize 로 생성). */
export default async function globalSetup() {
  const db = assertTestDatabase();
  const adminUrl = new URL(process.env.DATABASE_URL as string);
  adminUrl.pathname = '/postgres';
  const c = new Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${db}"`);
  await c.end();
}
