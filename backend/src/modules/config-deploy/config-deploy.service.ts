import {
  Injectable, Logger, OnModuleInit, Inject, forwardRef,
  NotFoundException, ConflictException, ServiceUnavailableException,
  GatewayTimeoutException, BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { SshProxyService } from '../ssh-proxy/ssh-proxy.service';
import { MqttService } from '../mqtt/mqtt.service';
import { EventsGateway } from '../gateway/events.gateway';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { removeProtectedFields, PROTECTED_FIELDS } from './protected-fields';
import {
  CommonConfig,
  DeployResult,
  PreviewResult,
  ConfigDiffItem,
  ConfigAction,
  ConfigRequestPayload,
  ConfigResponsePayload,
  RemoteConfigAccepted,
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

// 액션별 timeout (ms) — Design §6.2
const TIMEOUTS_MS: Record<ConfigAction, number> = {
  get_config: 30_000,
  update_config: 60_000,
  wifi_update: 90_000,
  hostname_update: 30_000,
  gateway_id_update: 60_000,
  identity_update: 90_000,  // hostname + gateway-id 통합 — gateway_id_update + 여유
  agent_update: 180_000,    // npm install + restart + verify 시간
  server_ip_update: 120_000,
  service_restart: 30_000,  // systemctl restart + is-active 검증
};

interface PendingRequest {
  gatewayId: string;
  action: ConfigAction;
  startedAt: number;
  timer: NodeJS.Timeout;
  userId: string;
  userName: string;
  /** action별 적용 후 DB에 반영할 컬럼 값 (성공 시) */
  applyOnSuccess?: Partial<Gateway>;
  /** gateway_id_update 전용 — 응답 성공 시 cascade 처리할 새 ID */
  newGatewayId?: string;
}

@Injectable()
export class ConfigDeployService implements OnModuleInit {
  private readonly logger = new Logger(ConfigDeployService.name);
  private template: CommonConfig = { ...DEFAULT_TEMPLATE };

  /** 게이트웨이별 진행 중인 요청 1건 (동시성 잠금) */
  private inflightByGateway = new Map<string, string>(); // gatewayId → requestId
  /** 전체 pending 요청 추적 */
  private pending = new Map<string, PendingRequest>(); // requestId → PendingRequest

  constructor(
    @Inject(forwardRef(() => GatewayManagerService))
    private gatewayService: GatewayManagerService,
    private sshService: SshProxyService,
    private mqttService: MqttService,
    private eventsGateway: EventsGateway,
    private activityLog: ActivityLogService,
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    this.mqttService.setConfigResponseHandler((gatewayId, payload) => {
      this.handleConfigResponse(gatewayId, payload);
    });
  }

  // ============================================================
  // 템플릿 관리 / SSH 기반 legacy API (기존 동작 유지)
  // ============================================================

  getTemplate(): CommonConfig {
    return this.template;
  }

  updateTemplate(config: CommonConfig): CommonConfig {
    this.template = removeProtectedFields(config) as CommonConfig;
    return this.template;
  }

  async getGatewayConfig(gatewayId: string): Promise<Record<string, any>> {
    const port = await this.sshService.getTunnelPort(gatewayId);
    const { stdout, code } = await this.sshService.exec(
      port,
      `cat ${Z2M_CONFIG_PATH}`,
    );
    if (code !== 0) throw new Error('설정 파일 읽기 실패');
    return (yaml.load(stdout) as Record<string, any>) ?? {};
  }

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

        const merged = { ...currentConfig, ...safeConfig };
        const newYaml = yaml.dump(merged, { lineWidth: -1 });

        const tmpPath = `/tmp/z2m-deploy-${Date.now()}.yaml`;
        await this.sshService.putFile(port, tmpPath, newYaml);

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

  // ============================================================
  // MQTT 기반 원격 설정 배포 (rpi-golden-image-system)
  // ============================================================

  /**
   * gpio-agent 등 systemd 서비스 안전 재시작 요청 (MQTT → config-agent → systemctl restart).
   * config-agent는 root로 실행되어 sudo 불필요. SSH 기반 path보다 안전.
   */
  async requestServiceRestart(
    gatewayId: string, service: 'gpio-agent' | 'zigbee2mqtt' | 'fallback-engine' | 'reverse-ssh-tunnel',
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    return this.publishAndTrack(
      gatewayId,
      'service_restart',
      { service },
      user,
    );
  }

  async requestWifi(
    gatewayId: string, ssid: string, password: string,
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    return this.publishAndTrack(
      gatewayId,
      'wifi_update',
      { wifi: { ssid, password } },
      user,
      { wifiSsid: ssid },
    );
  }

  async requestHostname(
    gatewayId: string, hostname: string,
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    // hostname 중복 검증 (자기 자신 제외)
    const dup = await this.gatewayRepo.findOne({ where: { hostname } });
    if (dup && dup.gatewayId !== gatewayId) {
      throw new ConflictException('이미 사용 중인 hostname입니다');
    }
    return this.publishAndTrack(
      gatewayId,
      'hostname_update',
      { hostname },
      user,
      { hostname },
    );
  }

  async requestGatewayId(
    gatewayId: string, newGatewayId: string,
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    if (newGatewayId === gatewayId) {
      throw new BadRequestException('새 gateway-id가 기존과 동일합니다');
    }
    const dup = await this.gatewayRepo.findOne({ where: { gatewayId: newGatewayId } });
    if (dup) {
      throw new ConflictException('이미 사용 중인 gateway-id입니다');
    }
    return this.publishAndTrack(
      gatewayId,
      'gateway_id_update',
      { gatewayId: newGatewayId },
      user,
      undefined,
      newGatewayId,
    );
  }

  async requestServerIp(
    gatewayId: string, newServerIp: string,
    user: { id: string; name: string },
    bootstrapToken?: string,
  ): Promise<RemoteConfigAccepted> {
    const payload: Record<string, any> = { serverIp: newServerIp };
    // 새 서버용 토큰이 오면 Pi에 함께 전달(재등록용). 추적 메타에는 토큰을 남기지 않는다(보안).
    if (bootstrapToken) payload.bootstrapToken = bootstrapToken;
    return this.publishAndTrack(
      gatewayId,
      'server_ip_update',
      payload,
      user,
      { serverIp: newServerIp },
    );
  }

  /**
   * rpi-agent-version-update
   * Pi의 agent(config-agent / gpio-agent / fallback-engine) 코드 update 요청.
   * PI 측에서 backend의 /agent-archive endpoint로 tar.gz 다운로드 → 백업 → 교체 → 재시작.
   */
  async requestAgentUpdate(
    gatewayId: string,
    agent: 'config-agent' | 'gpio-agent' | 'fallback-engine',
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    return this.publishAndTrack(
      gatewayId,
      'agent_update',
      { agent },
      user,
      undefined,
    );
  }

  /**
   * rpi-hostname-gateway-id-unify: hostname + gateway-id 통합 변경.
   * 양산 시나리오에서 둘은 항상 같은 값. 분리 배포로 인한 mismatch/실수 방지.
   * PI 측에서는 apply-identity.sh가 apply-hostname + apply-gateway-id 순차 실행.
   */
  async requestIdentity(
    gatewayId: string, name: string,
    user: { id: string; name: string },
  ): Promise<RemoteConfigAccepted> {
    if (name === gatewayId) {
      throw new BadRequestException('새 이름이 기존과 동일합니다');
    }
    // hostname / gateway-id 중복 검증 (자기 자신 제외)
    const dupHost = await this.gatewayRepo.findOne({ where: { hostname: name } });
    if (dupHost && dupHost.gatewayId !== gatewayId) {
      throw new ConflictException('이미 사용 중인 hostname입니다');
    }
    const dupId = await this.gatewayRepo.findOne({ where: { gatewayId: name } });
    if (dupId) {
      throw new ConflictException('이미 사용 중인 gateway-id입니다');
    }
    return this.publishAndTrack(
      gatewayId,
      'identity_update',
      { name },
      user,
      { hostname: name },  // applyOnSuccess — hostname 컬럼은 단순 갱신 (cascade는 applyDbChanges가 처리)
      name,                // gateway_id cascade를 위한 newGatewayId
    );
  }

  // ============================================================
  // First-Boot Tunnel Key Register
  // ============================================================

  async registerTunnelKey(params: {
    gatewayId: string;
    publicKey: string;
    machineId: string;
    rpiIp?: string;
  }): Promise<{
    registered: boolean;
    gatewayId: string;
    created: boolean;
    /** Pi가 tunnel.env 작성에 사용할 서버 정보 */
    tunnel: {
      serverHost: string;
      serverUser: string;
      serverPort: number;
      remotePort: number;
    };
  }> {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 자동 탐지/등록 정책 (양산 + 프로덕션 동일 워크플로우)
    //   1) machineId가 이미 DB에 있으면 → 같은 row 갱신 (재부팅/재이미지)
    //   2) gatewayId가 DB에 있고 machineId 미배정이면 → 빈 슬롯에 등록
    //   3) 모두 해당 없으면 → 새 게이트웨이 row 자동 생성
    //
    // BOOTSTRAP_TOKEN 인증은 controller에서 이미 검증됨.
    // 보안: 같은 게이트웨이 row에 다른 machineId가 들이대면 거부 (MAJOR-02).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 1. machineId로 기존 게이트웨이 조회 (재부팅/재이미지 케이스 — 항상 허용)
    let gateway = await this.gatewayRepo.findOne({ where: { machineId: params.machineId } });
    const sameMachineReReg = !!gateway;
    let autoCreated = false;

    // 2. 없으면 gatewayId로 조회 → 빈 슬롯(machineId 미배정 + 토큰 미사용)이면 사용
    if (!gateway) {
      const slot = await this.gatewayRepo.findOne({ where: { gatewayId: params.gatewayId } });
      if (slot && !slot.machineId && !slot.bootstrapTokenUsedAt) {
        gateway = slot; // 운영자가 사전 등록해둔 빈 슬롯에 들어감
      }
    }

    // 3. 그래도 없으면 자동 생성 (양산 시나리오 표준 경로)
    if (!gateway) {
      const ownerUserId = await this.findDefaultOwnerUserId();
      const shortMid = params.machineId.slice(0, 8);
      // gateway_id가 unique constraint → 충돌 없게 machineId 접미사 추가.
      // 빈 문자열/공백 또는 placeholder 'lgw-default' 인 경우 'lgw' 를 prefix 로 사용
      // (앞 '-' 가 붙은 invalid ID 생성 방지 — apply-gateway-id.sh 검증 통과).
      const sanitizedPrefix = (params.gatewayId ?? '').trim();
      const prefix = !sanitizedPrefix || sanitizedPrefix === 'lgw-default'
        ? 'lgw'
        : sanitizedPrefix;
      const newGatewayId = `${prefix}-${shortMid}`;
      gateway = this.gatewayRepo.create({
        userId: ownerUserId,
        gatewayId: newGatewayId,
        // 자동 등록 시 name은 gatewayId와 동일하게 (이후 운영자가 의미 있는 이름으로 변경 가능)
        // 운영자가 gatewayId만 바꾸면 name도 자동 추종 — isDefaultGatewayName() 패턴 매칭으로 처리.
        name: newGatewayId,
        hostname: params.gatewayId,
        rpiIp: params.rpiIp ?? undefined,
        machineId: params.machineId,
        status: 'offline',
        agentStatus: 'offline',
      } as Partial<Gateway>) as Gateway;
      autoCreated = true;
      this.logger.log(
        `자동 게이트웨이 생성: ${newGatewayId} (machineId=${params.machineId}, rpiIp=${params.rpiIp})`,
      );
    }

    // TypeScript narrowing: 이 시점에 gateway는 반드시 non-null
    if (!gateway) {
      throw new Error('internal: gateway unexpectedly null after auto-create branch');
    }

    // 4. 1회 사용 후 무효화 정책 (MAJOR-02)
    //    - 같은 machineId 재등록 → 허용 (재이미지 시나리오)
    //    - 다른 machineId가 이미 사용된 게이트웨이 차지 시도 → 거부
    if (gateway.bootstrapTokenUsedAt && !sameMachineReReg && !autoCreated) {
      const usedAt = gateway.bootstrapTokenUsedAt.toISOString();
      this.logger.warn(
        `bootstrap token 재사용 시도 거부: gatewayId=${gateway.gatewayId} ` +
        `previousMachineId=${gateway.machineId} attemptedMachineId=${params.machineId} usedAt=${usedAt}`,
      );
      await this.activityLog.log({
        userId: gateway.userId,
        userName: 'system',
        action: 'gateway.tunnel-key.rejected',
        targetType: 'gateway',
        targetId: gateway.gatewayId,
        targetName: gateway.name,
        details: {
          reason: 'bootstrap_token_already_used',
          previousMachineId: gateway.machineId,
          attemptedMachineId: params.machineId,
          rpiIp: params.rpiIp,
          usedAt,
        },
      });
      throw new ConflictException(
        '이 게이트웨이는 이미 다른 Pi가 점유했습니다. ' +
        '관리자에게 새 슬롯 또는 토큰 재발급을 요청하세요.',
      );
    }

    // 5. unique remote_port 할당 (게이트웨이당 1회만)
    if (!gateway.tunnelPort) {
      gateway.tunnelPort = await this.allocateUniqueRemotePort();
    }

    // 6. 키 + machineId + 토큰 사용시각 + IP 업데이트
    gateway.tunnelPublicKey = params.publicKey;
    gateway.machineId = params.machineId;
    gateway.bootstrapTokenUsedAt = new Date();
    if (params.rpiIp) gateway.rpiIp = params.rpiIp;
    if (!gateway.hostname) gateway.hostname = params.gatewayId; // lgw-default
    await this.gatewayRepo.save(gateway);

    // 7. mac mini의 ~/.ssh/authorized_keys에 키 등록 (자동 tunnel 인증)
    await this.upsertAuthorizedKey(gateway.gatewayId, params.publicKey, gateway.tunnelPort!);

    const action = autoCreated
      ? 'gateway.tunnel-key.auto-created'
      : sameMachineReReg
        ? 'gateway.tunnel-key.re-registered'
        : 'gateway.tunnel-key.registered';

    await this.activityLog.log({
      userId: gateway.userId,
      userName: 'system',
      action,
      targetType: 'gateway',
      targetId: gateway.gatewayId,
      targetName: gateway.name,
      details: { machineId: params.machineId, rpiIp: params.rpiIp, autoCreated, sameMachineReReg },
    });

    this.logger.log(
      `tunnel key ${autoCreated ? '자동 생성+' : sameMachineReReg ? '재' : ''}등록: ` +
      `${gateway.gatewayId} (machineId=${params.machineId}, remotePort=${gateway.tunnelPort})`,
    );

    // 응답: Pi가 tunnel.env 작성에 쓸 정보
    return {
      registered: true,
      gatewayId: gateway.gatewayId,
      created: autoCreated,
      tunnel: {
        serverHost: this.configService.get<string>('TUNNEL_SERVER_HOST') || '172.30.1.42',
        serverUser: this.configService.get<string>('TUNNEL_SERVER_USER') || 'pi',
        serverPort: parseInt(this.configService.get<string>('TUNNEL_SERVER_PORT') || '22', 10),
        remotePort: gateway.tunnelPort!,
      },
    };
  }

  /** 게이트웨이별 unique remote_port 할당 — TUNNEL_REMOTE_PORT_BASE부터 가장 작은 빈 포트 */
  private async allocateUniqueRemotePort(): Promise<number> {
    const base = parseInt(this.configService.get<string>('TUNNEL_REMOTE_PORT_BASE') || '22200', 10);
    const used = await this.gatewayRepo
      .createQueryBuilder('g')
      .select('g.tunnelPort', 'port')
      .where('g.tunnel_port IS NOT NULL')
      .getRawMany();
    const usedSet = new Set(used.map((r: any) => Number(r.port)));
    for (let port = base; port < base + 10000; port++) {
      if (!usedSet.has(port)) return port;
    }
    throw new Error('tunnel remote_port pool 소진');
  }

  /**
   * mac/서버의 ~/.ssh/authorized_keys 에 Pi의 tunnel key 한 줄 등록 (또는 갱신).
   * 보안: restrict + permitlisten 옵션으로 해당 remote_port port-forward만 허용.
   * 게이트웨이별로 식별 가능하도록 line 끝에 `tunnel@<gatewayId>` 코멘트 부착.
   */
  private async upsertAuthorizedKey(gatewayId: string, publicKey: string, remotePort: number): Promise<void> {
    const akPath = this.configService.get<string>('TUNNEL_AUTHORIZED_KEYS_PATH');
    if (!akPath) {
      this.logger.warn('TUNNEL_AUTHORIZED_KEYS_PATH 미설정 — authorized_keys 자동 등록 skip');
      return;
    }
    try {
      // 디렉토리 보장 (.ssh 700)
      const dir = require('path').dirname(akPath);
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch { /* exists */ }

      // 기존 내용 읽기 (없으면 빈 문자열)
      let content = '';
      try { content = fs.readFileSync(akPath, 'utf8'); } catch { /* missing */ }

      // 이 게이트웨이의 기존 라인 제거 (코멘트로 식별)
      const marker = `tunnel@${gatewayId}`;
      const lines = content.split('\n').filter((l) => l && !l.includes(marker));

      // 새 라인 추가 — port-forward 전용 옵션
      // restrict: shell/X11/agent/pty 모두 금지
      // permitlisten: 지정된 remote_port 만 -R 허용
      const restrictedOpts = `restrict,port-forwarding,permitlisten="${remotePort}"`;
      // publicKey 자체에 코멘트가 있을 수 있으니 잘라내고 우리 marker로 교체
      const keyParts = publicKey.trim().split(/\s+/);
      const keyType = keyParts[0];
      const keyBlob = keyParts[1];
      const finalLine = `${restrictedOpts} ${keyType} ${keyBlob} ${marker}`;
      lines.push(finalLine);

      // 파일 쓰기 (mode 600)
      fs.writeFileSync(akPath, lines.join('\n') + '\n', { mode: 0o600 });
      this.logger.log(`authorized_keys 갱신: ${akPath} (gateway=${gatewayId}, port=${remotePort})`);
    } catch (err: any) {
      this.logger.error(`authorized_keys 갱신 실패: ${err?.message ?? err}`);
      // 등록 자체는 계속 진행 (Pi는 tunnel 미동작 + MQTT만 동작)
    }
  }

  /** 자동 생성된 게이트웨이의 디폴트 owner — 첫 admin user */
  private async findDefaultOwnerUserId(): Promise<string> {
    const row = await this.gatewayRepo.manager.query(
      `SELECT id FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1`,
    );
    if (!row || row.length === 0) {
      throw new NotFoundException('admin 사용자가 없습니다 — 자동 게이트웨이 owner 지정 불가');
    }
    return row[0].id;
  }

  // ============================================================
  // 내부 — publish + pending tracking + response handler
  // ============================================================

  private async publishAndTrack(
    gatewayId: string,
    action: ConfigAction,
    payloadExtras: Partial<ConfigRequestPayload>,
    user: { id: string; name: string },
    applyOnSuccess?: Partial<Gateway>,
    newGatewayId?: string,
  ): Promise<RemoteConfigAccepted> {
    // 1. 게이트웨이 존재 확인
    const gateway = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gateway) {
      throw new NotFoundException(`게이트웨이를 찾을 수 없습니다: ${gatewayId}`);
    }

    // 2. 동시성 잠금
    if (this.inflightByGateway.has(gatewayId)) {
      throw new ConflictException('이전 원격 설정 요청이 아직 적용 중입니다');
    }

    // 3. MQTT 미연결 시 503
    if (!this.mqttService.isConnected()) {
      throw new ServiceUnavailableException('MQTT broker에 연결되어 있지 않습니다');
    }

    // 4. requestId 발급 + publish
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const payload: ConfigRequestPayload = {
      requestId,
      action,
      timestamp,
      ...payloadExtras,
    };

    try {
      await this.mqttService.publishConfigRequest(gatewayId, payload);
    } catch (err: any) {
      throw new ServiceUnavailableException(
        `MQTT 발행 실패: ${err?.message ?? 'unknown'}`,
      );
    }

    // 5. 활동 로그 (requested)
    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: `gateway.config.${actionToLogSuffix(action)}.requested`,
      targetType: 'gateway',
      targetId: gatewayId,
      targetName: gateway.name,
      details: this.summarizePayload(action, payloadExtras),
    });

    // 6. pending 등록 + timeout
    this.inflightByGateway.set(gatewayId, requestId);
    const timer = setTimeout(() => {
      this.handleTimeout(requestId);
    }, TIMEOUTS_MS[action]);

    this.pending.set(requestId, {
      gatewayId,
      action,
      startedAt: Date.now(),
      timer,
      userId: user.id,
      userName: user.name,
      applyOnSuccess,
      newGatewayId,
    });

    return { requestId, action, status: 'pending', publishedAt: timestamp };
  }

  private handleConfigResponse(gatewayId: string, payloadBuf: Buffer) {
    let response: ConfigResponsePayload;
    try {
      response = JSON.parse(payloadBuf.toString()) as ConfigResponsePayload;
    } catch {
      this.logger.warn(`config response JSON 파싱 실패 (${gatewayId})`);
      return;
    }

    const { requestId, action, success, status, detail, error } = response;
    if (!requestId) return;

    const pending = this.pending.get(requestId);
    if (!pending) {
      // legacy update_config 의 응답이거나 timeout 이후 도착 — 무시
      this.logger.debug(`unknown requestId=${requestId} (gateway=${gatewayId})`);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (this.inflightByGateway.get(gatewayId) === requestId) {
      this.inflightByGateway.delete(gatewayId);
    }

    const finalStatus = status ?? (success ? 'success' : 'failed');
    const logSuffix = `${actionToLogSuffix(pending.action)}.${finalStatus}`;

    // DB 반영 (성공 시)
    if (success && finalStatus !== 'failed') {
      this.applyDbChanges(gatewayId, pending).catch((err) => {
        this.logger.warn(`DB 반영 실패 (${gatewayId}): ${err?.message}`);
      });
    }

    // 활동 로그
    this.activityLog.log({
      userId: pending.userId,
      userName: pending.userName,
      action: `gateway.config.${logSuffix}`,
      targetType: 'gateway',
      targetId: gatewayId,
      targetName: gatewayId,
      details: { requestId, detail, error, durationMs: Date.now() - pending.startedAt },
    }).catch(() => {});

    // WebSocket 전송 — 사용자 + admins
    this.gatewayRepo.findOne({ where: { gatewayId } }).then((gw) => {
      const wsPayload = {
        gatewayId,
        requestId,
        action,
        success,
        status: finalStatus,
        detail: detail ?? error,
        pingResult: response.pingResult,
        appliedAt: response.appliedAt ?? new Date().toISOString(),
      };
      if (gw?.userId) {
        this.eventsGateway['server']
          ?.to(`user:${gw.userId}`)
          .emit(`config:response:${gatewayId}`, wsPayload);
      }
      this.eventsGateway['server']
        ?.to('admins')
        .emit(`config:response:${gatewayId}`, wsPayload);
    }).catch(() => {});
  }

  private async applyDbChanges(gatewayId: string, pending: PendingRequest) {
    // gateway_id_update / identity_update — FK cascade가 schema에 명시되어 있다면 raw UPDATE 한 번이면 충분.
    // 안전을 위해 트랜잭션으로 묶고, 결과 검증.
    // identity_update는 hostname도 함께 갱신.
    if ((pending.action === 'gateway_id_update' || pending.action === 'identity_update') && pending.newGatewayId) {
      const newId = pending.newGatewayId;
      const isIdentity = pending.action === 'identity_update';
      await this.gatewayRepo.manager.transaction(async (mgr) => {
        const gw = await mgr.findOne(Gateway, { where: { gatewayId } });
        if (!gw) {
          this.logger.warn(`${pending.action}: 게이트웨이 미발견 ${gatewayId}`);
          return;
        }
        // name이 자동 등록 디폴트 패턴이거나 이전 gatewayId와 동일하면 새 gatewayId로 자동 추종.
        // (운영자가 의미 있는 이름으로 바꾼 경우는 보존)
        const shouldRenameDefault =
          gw.name === gw.gatewayId ||
          gw.name?.startsWith('자동 등록 ') ||
          gw.name?.startsWith('자동등록 ');
        // 1. PK가 아닌 unique 컬럼 변경이므로 raw UPDATE. identity_update는 hostname도 동기화.
        await mgr.update(Gateway, { id: gw.id }, {
          gatewayId: newId,
          ...(isIdentity ? { hostname: newId } : {}),
          ...(shouldRenameDefault ? { name: newId } : {}),
          lastConfigAppliedAt: new Date(),
        });
        // 2. FK 관련 테이블 명시 cascade.
        //    BUG-03 fix: gateway_onboard_devices.gateway_id는 UUID(gateways.id 참조)이므로 변경 불필요.
        //    BUG-09 fix: gateway-id 변경 시 fallback_* 테이블의 옛 row도 cascade.
        await mgr.query(
          `UPDATE devices SET gateway_id = $1 WHERE gateway_id = $2`,
          [newId, gatewayId],
        ).catch((e) => {
          this.logger.warn(`devices cascade 실패: ${e.message}`);
        });
        for (const tbl of ['fallback_configs', 'fallback_gateway_status', 'fallback_opener_schedule', 'fallback_events']) {
          await mgr.query(
            `UPDATE ${tbl} SET gateway_id = $1 WHERE gateway_id = $2`,
            [newId, gatewayId],
          ).catch((e) => {
            this.logger.warn(`${tbl} cascade 실패: ${e.message}`);
          });
        }
      });
      this.logger.log(`${pending.action} cascade 완료: ${gatewayId} -> ${newId}`);
      return;
    }

    // 그 외 action들은 entity field만 갱신
    const gateway = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gateway) return;

    if (pending.applyOnSuccess) {
      Object.assign(gateway, pending.applyOnSuccess);
    }
    gateway.lastConfigAppliedAt = new Date();
    await this.gatewayRepo.save(gateway);
  }

  private handleTimeout(requestId: string) {
    const pending = this.pending.get(requestId);
    if (!pending) return;

    this.pending.delete(requestId);
    if (this.inflightByGateway.get(pending.gatewayId) === requestId) {
      this.inflightByGateway.delete(pending.gatewayId);
    }

    this.activityLog.log({
      userId: pending.userId,
      userName: pending.userName,
      action: `gateway.config.${actionToLogSuffix(pending.action)}.failed`,
      targetType: 'gateway',
      targetId: pending.gatewayId,
      targetName: pending.gatewayId,
      details: {
        requestId,
        error: 'timeout',
        timeoutMs: TIMEOUTS_MS[pending.action],
      },
    }).catch(() => {});

    this.gatewayRepo.findOne({ where: { gatewayId: pending.gatewayId } }).then((gw) => {
      const wsPayload = {
        gatewayId: pending.gatewayId,
        requestId,
        action: pending.action,
        success: false,
        status: 'failed' as const,
        detail: '응답 시간 초과',
        appliedAt: new Date().toISOString(),
      };
      if (gw?.userId) {
        this.eventsGateway['server']
          ?.to(`user:${gw.userId}`)
          .emit(`config:response:${pending.gatewayId}`, wsPayload);
      }
      this.eventsGateway['server']
        ?.to('admins')
        .emit(`config:response:${pending.gatewayId}`, wsPayload);
    }).catch(() => {});

    this.logger.warn(
      `config request timeout: ${pending.action} (gateway=${pending.gatewayId}, requestId=${requestId})`,
    );
  }

  private summarizePayload(action: ConfigAction, extras: Partial<ConfigRequestPayload>): any {
    switch (action) {
      case 'wifi_update':
        return { ssid: extras.wifi?.ssid };
      case 'hostname_update':
        return { hostname: extras.hostname };
      case 'gateway_id_update':
        return { newGatewayId: extras.gatewayId };
      case 'server_ip_update':
        return { newServerIp: extras.serverIp };
      default:
        return {};
    }
  }

  // ============================================================
  // Private — Z2M YAML diff (legacy)
  // ============================================================

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

/** action enum → activity log suffix */
function actionToLogSuffix(action: ConfigAction): string {
  switch (action) {
    case 'wifi_update':       return 'wifi';
    case 'hostname_update':   return 'hostname';
    case 'gateway_id_update': return 'gatewayid';
    case 'server_ip_update':  return 'serverip';
    case 'update_config':     return 'z2myaml';
    default:                  return action;
  }
}

// throw new GatewayTimeoutException — explicit import retained for future tightening
void GatewayTimeoutException;
