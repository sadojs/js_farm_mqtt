/** Config Agent에 보내는 요청 */
export interface ConfigRequest {
  requestId: string;
  action: 'get_config' | 'update_config';
  config?: CommonConfig;
  timestamp: string;
}

/** Config Agent에서 오는 응답 */
export interface ConfigResponse {
  requestId: string;
  action: 'get_config' | 'update_config';
  success: boolean;
  error?: string;
  currentConfig?: Record<string, any>;
  changedFields?: string[];
  serviceRestarted?: boolean;
  timestamp: string;
  agentVersion: string;
}

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

/** 배포 실행 결과 */
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

/** 응답 대기 */
export interface PendingRequest {
  resolve: (response: ConfigResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
