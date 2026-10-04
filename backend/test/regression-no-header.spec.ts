import request from 'supertest';
import { createTestApp, tokenFor, TestApp } from './utils/test-app';
import { seed, USERS } from './utils/seed';
import { FARM_ENDPOINTS, PLATFORM_ENDPOINTS, normalize } from './utils/endpoints';

/**
 * (a)·(f) 헤더 없는 요청의 응답이 변경 전과 100% 동일함을 스냅샷으로 증명한다.
 * 스냅샷은 farm context 구현 **이전** 코드에서 생성·커밋했고, 구현 후 같은 스냅샷과 일치해야 통과한다.
 * (jest --ci 로 실행하면 스냅샷이 없거나 다르면 실패)
 */
describe('헤더 없는 요청 회귀 (변경 전과 동일)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await seed(t.ds);
  });
  afterAll(async () => { await t?.app.close(); });

  const roles: Array<[string, keyof typeof USERS, string[]]> = [
    ['플랫폼 관리자(전체 합산)', 'admin', [...FARM_ENDPOINTS, ...PLATFORM_ENDPOINTS]],
    ['농장 관리자', 'f1', FARM_ENDPOINTS],
    ['농장 사용자', 'u1', FARM_ENDPOINTS],
  ];

  for (const [label, key, endpoints] of roles) {
    describe(label, () => {
      for (const path of endpoints) {
        it(`GET ${path}`, async () => {
          const res = await request(t.app.getHttpServer())
            .get(path)
            .set('Authorization', `Bearer ${tokenFor(USERS[key])}`);
          expect({ status: res.status, body: normalize(res.text || null) }).toMatchSnapshot();
        });
      }
    });
  }
});
