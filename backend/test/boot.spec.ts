import { createTestApp, TestApp } from './utils/test-app';

describe('테스트 하네스 부팅', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t?.app.close(); });

  it('일회용 테스트 DB 에 연결되고 스키마가 생성된다', async () => {
    const [{ db }] = await t.ds.query('select current_database() as db');
    expect(db).toMatch(/_test$/);
    const [{ n }] = await t.ds.query(`select count(*)::int as n from information_schema.tables where table_schema='public'`);
    expect(n).toBeGreaterThan(20);
  });

  it('MQTT 는 mock 이라 브로커에 연결하지 않는다', () => {
    expect(t.mqtt.isConnected()).toBe(false);
  });
});
