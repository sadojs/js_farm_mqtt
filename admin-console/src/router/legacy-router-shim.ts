/**
 * 기존 frontend/src/router/index.ts 대체 모듈.
 * vite.config.ts 의 legacyRouterShim 플러그인이 기존 코드의 라우터 import(예: api/client.ts 의 '../router')를
 * 이 파일로 연결한다 → 기존 라우터 인스턴스(기존 앱 경로·가드)가 콘솔 안에서 생성되지 않는다.
 * 기존 모듈이 export 하던 이름을 그대로 제공한다.
 */
import router from './index'

export default router

/** 기존 앱의 "로그인 후 기본 경로" — 콘솔에서는 플랫폼 개요 */
export function defaultAuthedPath(): string {
  return '/'
}
