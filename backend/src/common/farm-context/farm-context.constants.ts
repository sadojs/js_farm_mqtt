import { HttpException } from '@nestjs/common';

/** 요청 헤더 (express 는 소문자로 정규화) */
export const FARM_CONTEXT_HEADER = 'x-farm-context';
/** 응답 헤더: 적용된 농장 id 또는 'none'(플랫폼 라우트라 무시) */
export const FARM_CONTEXT_APPLIED_HEADER = 'X-Farm-Context-Applied';

export const FarmContextCode = {
  FORBIDDEN: 'FARM_CONTEXT_FORBIDDEN',
  INVALID: 'FARM_CONTEXT_INVALID',
  NOT_FOUND: 'FARM_CONTEXT_NOT_FOUND',
  NOT_FARM_ADMIN: 'FARM_CONTEXT_NOT_FARM_ADMIN',
  INACTIVE: 'FARM_CONTEXT_INACTIVE',
} as const;
export type FarmContextCodeType = (typeof FarmContextCode)[keyof typeof FarmContextCode];

const MESSAGES: Record<FarmContextCodeType, string> = {
  FARM_CONTEXT_FORBIDDEN: '농장 컨텍스트(X-Farm-Context)는 플랫폼 관리자만 사용할 수 있습니다.',
  FARM_CONTEXT_INVALID: '농장 컨텍스트 값이 올바른 사용자 ID 형식이 아닙니다.',
  FARM_CONTEXT_NOT_FOUND: '농장 컨텍스트 대상 사용자를 찾을 수 없습니다.',
  FARM_CONTEXT_NOT_FARM_ADMIN: '농장 컨텍스트 대상은 농장 관리자(farm_admin)여야 합니다.',
  FARM_CONTEXT_INACTIVE: '농장 컨텍스트 대상 농장 관리자 계정이 비활성 상태입니다.',
};

const STATUS: Record<FarmContextCodeType, number> = {
  FARM_CONTEXT_FORBIDDEN: 403,
  FARM_CONTEXT_INVALID: 400,
  FARM_CONTEXT_NOT_FOUND: 404,
  FARM_CONTEXT_NOT_FARM_ADMIN: 400,
  FARM_CONTEXT_INACTIVE: 400,
};

/** 응답 본문: 기존 형식(statusCode·message) + code */
export class FarmContextException extends HttpException {
  constructor(readonly code: FarmContextCodeType) {
    super({ statusCode: STATUS[code], message: MESSAGES[code], code }, STATUS[code]);
  }
  toPayload() {
    return { code: this.code, message: MESSAGES[this.code] };
  }
}
