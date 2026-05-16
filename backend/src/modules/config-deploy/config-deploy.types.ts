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

