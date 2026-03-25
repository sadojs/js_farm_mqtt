import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { removeProtectedFields, PROTECTED_FIELDS } from './protected-fields';
import {
  ConfigRequest,
  ConfigResponse,
  CommonConfig,
  DeployResult,
  PreviewResult,
  ConfigDiffItem,
  PendingRequest,
} from './config-deploy.types';

const REQUEST_TIMEOUT_MS = 15_000;

/** 기본 공통 설정 템플릿 */
const DEFAULT_TEMPLATE: CommonConfig = {
  homeassistant: false,
  frontend: { port: 8080, host: '0.0.0.0' },
  advanced: {
    log_level: 'info',
    channel: 11,
    last_seen: 'ISO_8601',
    legacy_api: false,
    legacy_availability_payload: false,
    log_output: ['console'],
  },
  availability: {
    active: { timeout: 10 },
    passive: { timeout: 1500 },
  },
  ota: {
    disable_automatic_update_check: true,
  },
};

@Injectable()
export class ConfigDeployService {
  private readonly logger = new Logger(ConfigDeployService.name);
  private pendingRequests = new Map<string, PendingRequest>();
  private template: CommonConfig = { ...DEFAULT_TEMPLATE };

  /** MQTT publish 함수 (MqttService에서 주입) */
  private publishFn: ((gatewayId: string, request: ConfigRequest) => void) | null = null;

  constructor(
    private gatewayService: GatewayManagerService,
  ) {}

  /** MqttService에서 publish 함수 설정 */
  setPublishFunction(fn: (gatewayId: string, request: ConfigRequest) => void) {
    this.publishFn = fn;
  }

  // ---- 템플릿 관리 ----

  getTemplate(): CommonConfig {
    return this.template;
  }

  updateTemplate(config: CommonConfig): CommonConfig {
    this.template = removeProtectedFields(config) as CommonConfig;
    return this.template;
  }

  // ---- 게이트웨이 설정 조회 ----

  async getGatewayConfig(gatewayId: string): Promise<Record<string, any>> {
    const response = await this.sendRequest(gatewayId, 'get_config');
    if (!response.success) {
      throw new Error(response.error || '설정 조회 실패');
    }
    return response.currentConfig || {};
  }

  // ---- 미리보기 ----

  async previewDeploy(
    gatewayIds: string[],
    config: Record<string, any>,
  ): Promise<PreviewResult[]> {
    const safeConfig = removeProtectedFields(config);
    const results: PreviewResult[] = [];

    for (const gatewayId of gatewayIds) {
      const gateway = await this.gatewayService.findByGatewayId(gatewayId);

      try {
        const currentConfig = await this.getGatewayConfig(gatewayId);
        const diff = this.computeDiff(currentConfig, safeConfig);

        results.push({
          gatewayId,
          gatewayName: gateway?.name || gatewayId,
          status: 'online',
          currentConfig,
          diff,
        });
      } catch {
        results.push({
          gatewayId,
          gatewayName: gateway?.name || gatewayId,
          status: gateway?.status === 'online' ? 'no-agent' : 'offline',
        });
      }
    }

    return results;
  }

  // ---- 배포 실행 ----

  async deployConfig(
    gatewayIds: string[],
    config: Record<string, any>,
  ): Promise<DeployResult[]> {
    const safeConfig = removeProtectedFields(config);
    const results: DeployResult[] = [];

    // 순차 배포 (동시 부하 방지)
    for (const gatewayId of gatewayIds) {
      const gateway = await this.gatewayService.findByGatewayId(gatewayId);
      const start = Date.now();

      try {
        const response = await this.sendRequest(gatewayId, 'update_config', safeConfig);

        results.push({
          gatewayId,
          gatewayName: gateway?.name || gatewayId,
          success: response.success,
          error: response.error,
          changedFields: response.changedFields,
          serviceRestarted: response.serviceRestarted,
          duration: Date.now() - start,
        });
      } catch (err) {
        results.push({
          gatewayId,
          gatewayName: gateway?.name || gatewayId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
          duration: Date.now() - start,
        });
      }
    }

    this.logger.log(
      `배포 완료: ${results.filter(r => r.success).length}/${results.length} 성공`,
    );

    return results;
  }

  // ---- MQTT 응답 핸들러 ----

  handleConfigResponse(gatewayId: string, payload: Buffer) {
    let response: ConfigResponse;
    try {
      response = JSON.parse(payload.toString());
    } catch {
      this.logger.error(`잘못된 config 응답: ${gatewayId}`);
      return;
    }

    const pending = this.pendingRequests.get(response.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.requestId);
      pending.resolve(response);
      this.logger.log(
        `Config 응답: ${gatewayId} → ${response.action} ${response.success ? '성공' : '실패'}`,
      );
    }
  }

  // ---- Private ----

  private sendRequest(
    gatewayId: string,
    action: 'get_config' | 'update_config',
    config?: Record<string, any>,
  ): Promise<ConfigResponse> {
    if (!this.publishFn) {
      return Promise.reject(new Error('MQTT 미연결'));
    }

    const requestId = randomUUID();
    const request: ConfigRequest = {
      requestId,
      action,
      timestamp: new Date().toISOString(),
      ...(config && { config }),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('응답 타임아웃 (Config Agent 미응답)'));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      this.publishFn!(gatewayId, request);
    });
  }

  private computeDiff(
    current: Record<string, any>,
    requested: Record<string, any>,
    prefix = '',
  ): ConfigDiffItem[] {
    const diffs: ConfigDiffItem[] = [];
    const allKeys = new Set([
      ...Object.keys(requested),
    ]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const isProtected = PROTECTED_FIELDS.some(
        f => path === f || path.startsWith(f + '.'),
      );

      const oldVal = current?.[key];
      const newVal = requested[key];

      if (
        newVal && typeof newVal === 'object' && !Array.isArray(newVal) &&
        oldVal && typeof oldVal === 'object' && !Array.isArray(oldVal)
      ) {
        diffs.push(...this.computeDiff(oldVal, newVal, path));
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diffs.push({ field: path, oldValue: oldVal, newValue: newVal, protected: isProtected });
      }
    }

    return diffs;
  }
}
