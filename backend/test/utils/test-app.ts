import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import * as cookieParser from 'cookie-parser';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../../src/app.module';
import { MqttService } from '../../src/modules/mqtt/mqtt.service';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { assertTestDatabase } from '../setup/env';

/**
 * MQTT mock — 브로커에 연결하지 않는다.
 * 목록 반환 메서드는 [] , 연결 상태는 false, 비동기 발행은 resolve 로 응답한다.
 * 정의되지 않은 메서드 접근은 no-op 함수로 대체(Proxy).
 */
export function createMqttMock(): any {
  const known: Record<string, any> = {
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
    isConnected: () => false,
    getZigbeeDevices: () => [],
    requestZigbeeDevices: async () => [],
    getCachedAvailability: () => undefined,
  };
  return new Proxy(known, {
    get(target, prop: string) {
      if (prop === 'then') return undefined;
      if (!(prop in target)) target[prop] = jest.fn(async () => undefined);
      return target[prop];
    },
  });
}

/** 크론/인터벌/타임아웃 정지 — 자동제어 러너 등이 테스트 데이터를 바꾸지 않게 한다. */
function stopSchedulers(app: INestApplication) {
  const reg = app.get(SchedulerRegistry);
  reg.getCronJobs().forEach((job) => job.stop());
  reg.getIntervals().forEach((name) => clearInterval(reg.getInterval(name)));
  reg.getTimeouts().forEach((name) => clearTimeout(reg.getTimeout(name)));
}

export interface TestApp {
  app: INestApplication;
  ds: DataSource;
  mqtt: any;
}

/** main.ts 와 동일한 전역 설정(prefix·ValidationPipe·ExceptionFilter·cookie)으로 앱을 띄운다. */
export async function createTestApp(): Promise<TestApp> {
  assertTestDatabase();
  const mqtt = createMqttMock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MqttService)
    .useValue(mqtt)
    .compile();

  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use((cookieParser as any).default ? (cookieParser as any).default() : (cookieParser as any)());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  stopSchedulers(app);

  const ds = app.get(DataSource);
  return { app, ds, mqtt };
}

export function tokenFor(user: { id: string; username: string; role: string; parentUserId?: string | null }) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, parentUserId: user.parentUserId ?? null },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
}
