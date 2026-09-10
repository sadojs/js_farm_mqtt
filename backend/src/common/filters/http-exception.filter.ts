import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = '서버 내부 오류가 발생했습니다.';
    // object 형태 예외의 커스텀 필드(dependencies 등)를 응답에 보존
    // (장치 삭제 차단 409 의 dependencies.automationRules 를 프론트 팝업이 사용)
    let extra: Record<string, any> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const { message: m, statusCode: _sc, error: _err, ...rest } = res as any;
        message = m ?? res;
        extra = rest;
      }
    }

    // 500 에러만 상세 로그 (스택 트레이스 포함)
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status}: ${JSON.stringify(message)}`);
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...extra,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
