import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

/**
 * 백엔드 단일 실행 보장 (PostgreSQL advisory lock).
 *
 * 자동제어 크론·관수 타임라인·개폐기 인터록 직렬화·MQTT 처리는 모두 프로세스 메모리 기준이라
 * 백엔드가 2개 이상 동시에 돌면(pm2 instances>1, 실수로 두 번 기동 등) 같은 명령이 중복 발행되고
 * 개폐기 인터록이 깨진다. 기동 시 DB 잠금을 잡고, 이미 다른 인스턴스가 잡고 있으면 기다렸다가
 * (재시작·reload 중 이전 프로세스 종료 대기) 끝내 못 잡으면 기동을 중단한다.
 * 잠금은 이 연결이 살아 있는 동안 유지되고, 프로세스가 끝나면 DB 가 자동 해제한다.
 *
 * 끄기: SINGLE_INSTANCE_LOCK=off (테스트·특수 상황용)
 */
const LOCK_KEY = 'smartfarm-mqtt-backend';
const WAIT_MS = 90_000;
const RETRY_MS = 3_000;
let held: Client | null = null;

export async function acquireInstanceLock(): Promise<void> {
  const logger = new Logger('InstanceLock');
  if ((process.env.SINGLE_INSTANCE_LOCK || '').toLowerCase() === 'off') {
    logger.warn('단일 실행 잠금 비활성화(SINGLE_INSTANCE_LOCK=off)');
    return;
  }
  dotenv.config({ path: '.env' });
  dotenv.config({ path: '../.env' });
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.warn('DATABASE_URL 없음 — 단일 실행 잠금 생략');
    return;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_KEY]);
    if (rows[0]?.ok) {
      held = client;
      client.on('error', (e) => logger.error(`잠금 연결 오류: ${e.message}`));
      logger.log('단일 실행 잠금 획득');
      return;
    }
    if (Date.now() > deadline) {
      await client.end().catch(() => undefined);
      logger.error('다른 백엔드 인스턴스가 실행 중입니다 — 자동제어 중복을 막기 위해 기동을 중단합니다. (pm2 instances 는 1 이어야 합니다)');
      process.exit(1);
    }
    logger.warn('다른 백엔드 인스턴스가 잠금을 보유 중 — 종료를 기다립니다...');
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

export function instanceLockHeld(): boolean {
  return held !== null;
}
