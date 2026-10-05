/**
 * 회귀·농장 스코프 테스트가 공통으로 쓰는 주요 GET 엔드포인트 (쿼리는 기존 frontend 호출과 동일한 형태).
 * farmData: 농장 데이터 화면(H 섹션)에서 쓰는 엔드포인트 — 농장 컨텍스트 적용 대상.
 */
const RANGE = 'startDate=2026-01-14&endDate=2026-01-16';

export const FARM_ENDPOINTS: string[] = [
  '/api/groups',
  '/api/groups/houses',
  '/api/groups/houses/iot-related-counts',
  '/api/devices',
  '/api/gateways',
  '/api/automation/rules',
  '/api/automation/logs',
  '/api/automation/logs/stats',
  '/api/automation/irrigation/status',
  '/api/automation/bulk-stopped-rules',
  '/api/dashboard/widgets',
  '/api/sensor-data/latest',
  `/api/sensor-data?${RANGE}&sensorType=temperature`,
  '/api/sensor-alerts',
  '/api/sensor-alerts/sensors',
  `/api/reports/statistics?${RANGE}&sensorType=temperature`,
  `/api/reports/hourly?${RANGE}&sensorType=temperature`,
  `/api/reports/actuator-stats?${RANGE}`,
  '/api/activity-logs',
  '/api/spray-schedule/zones',
  '/api/spray-schedule/events?from=2026-01-01&to=2026-02-28',
  '/api/worker-payroll/workers',
  '/api/work-log/task-types',
  '/api/work-log/logs',
  '/api/work-log/board',
  '/api/crop-management/batches',
  '/api/crop-management/dashboard',
  '/api/zone-notes',
  '/api/features',
  '/api/env-config/roles',
];

/** 플랫폼 전용·본인 정보 엔드포인트 — 헤더가 있어도 원래 관리자로 동작해야 한다. */
export const PLATFORM_ENDPOINTS: string[] = [
  '/api/auth/me',
  '/api/users',
  '/api/users/farm-admins',
  '/api/config-deploy/template',
  '/api/fallback-config/heartbeat/status',
  '/api/features/users/' + 'aaaaaaaa-0000-4000-8000-000000000001',
  '/api/crop-management/feature/all',
];

const FIXED_UUID = /^(1{8}|2{8}|3{8}|a{8})-0000-4000-8000-\d{12}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;

/** 스냅샷용 정규화: 시각·지연 생성 UUID 만 치환(고정 픽스처 UUID 는 유지해 교차 오염이 보이도록). */
export function normalize(body: unknown): unknown {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const out = (text ?? 'null')
    .replace(ISO, '<datetime>')
    .replace(UUID, (u) => (FIXED_UUID.test(u) ? u : '<uuid>'));
  try { return JSON.parse(out); } catch { return out; }
}
