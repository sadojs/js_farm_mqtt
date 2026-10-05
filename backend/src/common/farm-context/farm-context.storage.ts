import { AsyncLocalStorage } from 'async_hooks';

export interface FarmContextStore {
  farmId: string;
  actingAdminId: string;
  actingAdminUsername: string;
}

/**
 * 농장 컨텍스트로 처리 중인 요청의 실제 수행자 정보.
 * 요청 객체를 받지 않는 서비스(예: ActivityLogService)가 감사 정보를 남길 때 사용한다.
 * 헤더 없는 요청에서는 getStore() 가 undefined.
 */
export const farmContextStorage = new AsyncLocalStorage<FarmContextStore>();
