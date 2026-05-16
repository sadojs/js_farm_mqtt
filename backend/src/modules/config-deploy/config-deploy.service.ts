import { Injectable, Logger } from '@nestjs/common';
import * as yaml from 'js-yaml';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { SshProxyService } from '../ssh-proxy/ssh-proxy.service';
import { removeProtectedFields, PROTECTED_FIELDS } from './protected-fields';
import {
  CommonConfig,
  DeployResult,
  PreviewResult,
  ConfigDiffItem,
} from './config-deploy.types';

const Z2M_CONFIG_PATH = '/opt/zigbee2mqtt/data/configuration.yaml';
const Z2M_CONFIG_BACKUP = '/opt/zigbee2mqtt/data/configuration.yaml.bak';

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
  private template: CommonConfig = { ...DEFAULT_TEMPLATE };

  constructor(
    private gatewayService: GatewayManagerService,
    private sshService: SshProxyService,
  ) {}

  // ---- 템플릿 관리 ----

  getTemplate(): CommonConfig {
    return this.template;
  }

  updateTemplate(config: CommonConfig): CommonConfig {
    this.template = removeProtectedFields(config) as CommonConfig;
    return this.template;
  }

  // ---- 게이트웨이 설정 조회 (SSH) ----

  async getGatewayConfig(gatewayId: string): Promise<Record<string, any>> {
    const port = await this.sshService.getTunnelPort(gatewayId);
    const { stdout, code } = await this.sshService.exec(
      port,
      `cat ${Z2M_CONFIG_PATH}`,
    );
    if (code !== 0) throw new Error('설정 파일 읽기 실패');
    return (yaml.load(stdout) as Record<string, any>) ?? {};
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

  // ---- 배포 실행 (SSH) ----

  async deployConfig(
    gatewayIds: string[],
    config: Record<string, any>,
  ): Promise<DeployResult[]> {
    const safeConfig = removeProtectedFields(config);
    const results: DeployResult[] = [];

    for (const gatewayId of gatewayIds) {
      const gateway = await this.gatewayService.findByGatewayId(gatewayId);
      const start = Date.now();

      try {
        const port = await this.sshService.getTunnelPort(gatewayId);

        // 현재 설정 읽기
        const { stdout: currentYaml, code: readCode } = await this.sshService.exec(
          port,
          `cat ${Z2M_CONFIG_PATH}`,
        );
        if (readCode !== 0) throw new Error('설정 파일 읽기 실패');

        const currentConfig = (yaml.load(currentYaml) as Record<string, any>) ?? {};
        const diff = this.computeDiff(currentConfig, safeConfig);

        if (diff.length === 0) {
          results.push({
            gatewayId,
            gatewayName: gateway?.name || gatewayId,
            success: true,
            changedFields: [],
            serviceRestarted: false,
            duration: Date.now() - start,
          });
          continue;
        }

        // 보호 필드는 현재 값 유지, 나머지만 머지
        const merged = { ...currentConfig, ...safeConfig };
        const newYaml = yaml.dump(merged, { lineWidth: -1 });

        // 임시 파일로 업로드
        const tmpPath = `/tmp/z2m-deploy-${Date.now()}.yaml`;
        await this.sshService.putFile(port, tmpPath, newYaml);

        // 백업 → 교체 → 재시작 → 상태 확인
        const { code, stderr } = await this.sshService.exec(
          port,
          `sudo cp ${Z2M_CONFIG_PATH} ${Z2M_CONFIG_BACKUP} && \
           sudo cp ${tmpPath} ${Z2M_CONFIG_PATH} && \
           rm -f ${tmpPath} && \
           sudo systemctl restart zigbee2mqtt && \
           sleep 5 && \
           systemctl is-active zigbee2mqtt`,
        );

        if (code !== 0) {
          // 재시작 실패 시 백업 복원
          await this.sshService.exec(
            port,
            `sudo cp ${Z2M_CONFIG_BACKUP} ${Z2M_CONFIG_PATH} && sudo systemctl restart zigbee2mqtt`,
          ).catch(() => {});
          throw new Error(`Zigbee2MQTT 재시작 실패: ${stderr.trim()}`);
        }

        results.push({
          gatewayId,
          gatewayName: gateway?.name || gatewayId,
          success: true,
          changedFields: diff.map(d => d.field),
          serviceRestarted: true,
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

  // ---- Private ----

  private computeDiff(
    current: Record<string, any>,
    requested: Record<string, any>,
    prefix = '',
  ): ConfigDiffItem[] {
    const diffs: ConfigDiffItem[] = [];

    for (const key of Object.keys(requested)) {
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
