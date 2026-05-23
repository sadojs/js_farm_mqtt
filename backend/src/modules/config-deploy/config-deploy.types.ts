/** 배포 가능한 공통 설정 (보호 필드 제외) */
export interface CommonConfig {
  homeassistant?: boolean;
  frontend?: { port?: number; host?: string };
  advanced?: {
    log_level?: string;
    channel?: number;
    last_seen?: string;
    legacy_api?: boolean;
    legacy_availability_payload?: boolean;
    log_output?: string[];
  };
  availability?: {
    active?: { timeout: number };
    passive?: { timeout: number };
  };
  ota?: {
    disable_automatic_update_check?: boolean;
  };
}

/** 배포 실행 결과 (SSH 기반 legacy 흐름) */
export interface DeployResult {
  gatewayId: string;
  gatewayName: string;
  success: boolean;
  error?: string;
  changedFields?: string[];
  serviceRestarted?: boolean;
  duration: number;
}

/** 미리보기 결과 */
export interface PreviewResult {
  gatewayId: string;
  gatewayName: string;
  status: 'online' | 'offline' | 'no-agent';
  currentConfig?: Record<string, any>;
  diff?: ConfigDiffItem[];
}

export interface ConfigDiffItem {
  field: string;
  oldValue: any;
  newValue: any;
  protected: boolean;
}

// ============================================================
// MQTT 기반 원격 설정 배포 (rpi-golden-image-system)
// Design: docs/02-design/features/rpi-golden-image-system.design.md
// ============================================================

export type ConfigAction =
  | 'get_config'         // legacy — Z2M YAML 조회
  | 'update_config'      // legacy — Z2M YAML 갱신 (자동 롤백 유지)
  | 'wifi_update'        // 신규 — Wi-Fi SSID/PW 변경 (롤백 없음)
  | 'hostname_update'    // 신규 — hostname 변경 + reboot 예약
  | 'gateway_id_update'  // 신규 — gateway-id 변경 (DB + Pi)
  | 'identity_update'    // 신규 — hostname + gateway-id 통합 변경 (rpi-hostname-gateway-id-unify)
  | 'server_ip_update';  // 신규 — MQTT/tunnel 서버 IP 동시 변경

export type ConfigResponseStatus =
  | 'success'              // hostname / gateway-id 일반 성공
  | 'applied_online'       // wifi: 새 SSID + 인터넷 ping OK
  | 'applied_no_internet'  // wifi: 새 SSID 활성됐으나 ping 실패 (본사→농장 발송 정상 케이스)
  | 'rolled_back'          // update_config: Z2M YAML 자동 롤백 (기존 유지)
  | 'failed';

export interface ConfigRequestPayload {
  requestId: string;
  action: ConfigAction;
  timestamp: string;
  config?: CommonConfig;
  wifi?: { ssid: string; password: string };
  hostname?: string;
  gatewayId?: string;
  serverIp?: string;
  /** identity_update: hostname + gateway-id 통합 변경 — 둘 다 동일 값 */
  name?: string;
}

export interface ConfigResponsePayload {
  requestId: string;
  action: ConfigAction;
  success: boolean;
  status?: ConfigResponseStatus;
  timestamp: string;
  agentVersion?: string;
  detail?: string;
  error?: string;
  currentConfig?: Record<string, any>;
  changedFields?: string[];
  serviceRestarted?: boolean;
  appliedAt?: string;
  pingResult?: { tried: number; ok: number };
  rebootScheduled?: boolean;
}

/** Backend → Frontend 응답 (POST /api/config-deploy/:gw/{action}) */
export interface RemoteConfigAccepted {
  requestId: string;
  action: ConfigAction;
  status: 'pending';
  publishedAt: string;
}
