import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.use((helmet as any).default ? (helmet as any).default() : (helmet as any)());
  app.use((cookieParser as any).default ? (cookieParser as any).default() : (cookieParser as any)());

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT || 3100;
  await app.listen(port);
  logger.log(`Smart Farm MQTT API running on port ${port}`);

  // rpi-activity-log-pk-trace (BUG-04): MQTT 메시지 핸들러에서 발생한
  // QueryFailedError 등이 unhandledRejection으로 process abort 야기 → 안전망.
  process.on('unhandledRejection', (reason: any) => {
    logger.error(`UnhandledRejection (process kept alive): ${reason?.stack || String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`UncaughtException (process kept alive): ${err?.stack || String(err)}`);
  });
}
bootstrap();
