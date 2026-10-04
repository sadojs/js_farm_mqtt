/**
 * 테스트 전용 환경변수. 실제 DB·MQTT 에는 절대 연결하지 않는다.
 * - DB: 로컬 Postgres 의 일회용 DB(이름이 반드시 _test 로 끝남). global-setup 이 매 실행마다 새로 만든다.
 * - MQTT: MqttService 를 mock 으로 교체하므로 브로커에 연결하지 않는다.
 * - JWT: 테스트 전용 값(운영 비밀값 아님).
 */
process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Seoul';
process.env.DATABASE_URL =
  process.env.FARMSCOPE_TEST_DATABASE_URL ||
  `postgres://${process.env.USER}@localhost:5432/sf_farmscope_test`;
process.env.JWT_SECRET = 'farmscope-test-jwt-only-for-tests';
process.env.DISABLE_SERVER_HEARTBEAT = '1';
process.env.MQTT_URL = 'mqtt://127.0.0.1:1';

export function assertTestDatabase(): string {
  const db = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
  if (!/_test$/.test(db)) {
    throw new Error(`[farmscope-test] 테스트 DB 이름은 _test 로 끝나야 합니다 (현재: ${db}). 실제 DB 보호를 위해 중단합니다.`);
  }
  return db;
}
