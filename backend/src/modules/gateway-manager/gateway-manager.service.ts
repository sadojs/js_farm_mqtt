import { Injectable, NotFoundException, ConflictException, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Gateway } from './entities/gateway.entity';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { SshProxyService } from '../ssh-proxy/ssh-proxy.service';
import { ConfigDeployService } from '../config-deploy/config-deploy.service';

/** Pi에서 재시작을 허용하는 systemd 서비스 (보안 — 임의 서비스 실행 차단) */
const ALLOWED_SERVICES = new Set([
  'gpio-agent', 'zigbee2mqtt', 'fallback-engine', 'config-agent', 'reverse-ssh-tunnel',
]);

/** 자동 복구: gpio-agent heartbeat 부재가 이 시간 초과 시 1회 자동 restart 시도 (ms) */
const GPIO_AGENT_STALE_MS = 5 * 60 * 1000;   // 5분
/** 같은 게이트웨이에 대해 자동 restart cooldown — 무한 루프 방지 (ms) */
const AUTO_RESTART_COOLDOWN_MS = 15 * 60 * 1000; // 15분

/** agentStatus/tunnelStatus 갱신 없이 이 시간이 지나면 오프라인으로 간주 (ms) */
const AGENT_STALE_MS = 5 * 60 * 1000;    // 5분
const TUNNEL_STALE_MS = 3 * 60 * 1000;   // 3분

@Injectable()
export class GatewayManagerService {
  private readonly logger = new Logger(GatewayManagerService.name);

  /** 게이트웨이별 마지막 gpio/status 수신 시각 (메모리 캐시) */
  private gpioStatusLastSeen = new Map<string, number>();
  /** 게이트웨이별 마지막 자동 restart 시각 (cooldown 적용) */
  private lastAutoRestartAt = new Map<string, number>();

  constructor(
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    @InjectRepository(House) private houseRepo: Repository<House>,
    @InjectRepository(HouseGroup) private groupRepo: Repository<HouseGroup>,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => SshProxyService))
    private sshService: SshProxyService,
    @Inject(forwardRef(() => ConfigDeployService))
    private configDeployService: ConfigDeployService,
    private dataSource: DataSource,
  ) {}

  /**
   * 게이트웨이에 소속된 장치 + 종속 데이터를 일괄 삭제.
   * devices.gateway_id 는 gateways.id(uuid)를 varchar로 참조하며 FK cascade가 없어,
   * 게이트웨이 삭제 시 장치가 유령으로 남던 문제를 방지한다.
   */
  private async cleanupGatewayDevices(gatewayUuid: string): Promise<number> {
    return this.dataSource.transaction(async (m) => {
      const rows: Array<{ id: string }> = await m.query(
        `SELECT id::text AS id FROM devices WHERE gateway_id = $1`,
        [gatewayUuid],
      );
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return 0;
      // 생존 장치가 삭제 대상을 가리키는 self-ref 정리
      await m.query(`UPDATE devices SET paired_device_id=NULL WHERE paired_device_id::text = ANY($1::text[])`, [ids]);
      await m.query(`UPDATE devices SET parent_device_id=NULL WHERE parent_device_id::text = ANY($1::text[]) AND id::text <> ALL($1::text[])`, [ids]);
      // FK가 없는 종속 테이블은 명시적으로 정리
      for (const t of ['sensor_data', 'sensor_alerts', 'sensor_standby', 'env_mappings', 'group_devices']) {
        await m.query(`DELETE FROM ${t} WHERE device_id::text = ANY($1::text[])`, [ids]);
      }
      await m.query(`DELETE FROM devices WHERE id::text = ANY($1::text[])`, [ids]);
      return ids.length;
    });
  }

  /** mqtt-bridge.handler가 gpio/status 토픽 수신 시 호출 — 마지막 응답 시각 트래킹 */
  recordGpioStatus(gatewayCode: string) {
    this.gpioStatusLastSeen.set(gatewayCode, Date.now());
  }

  /**
   * Pi systemd 서비스 재시작 (수동/자동 공통 경로).
   * 우선순위: 1) MQTT → config-agent (root 권한, sudo 불필요)
   *           2) SSH → sudo systemctl (NOPASSWD 설정 필요 — fallback)
   * config-agent path가 더 안전·보편적이므로 가급적 이쪽 사용.
   */
  async restartPiService(gw: Gateway, service: string): Promise<{ success: boolean; service: string; output?: string; error?: string; via?: 'mqtt' | 'ssh' }> {
    if (!ALLOWED_SERVICES.has(service)) {
      throw new Error(`허용되지 않은 서비스: ${service}. 가능: ${[...ALLOWED_SERVICES].join(', ')}`);
    }
    // 1) MQTT path — config-agent 가 살아있고 agent_status=online일 때
    if (gw.agentStatus === 'online') {
      try {
        const result: any = await this.configDeployService.requestServiceRestart(
          gw.gatewayId,
          service as any,
          { id: 'system', name: 'auto-recovery' },
        );
        this.logger.log(`[${gw.gatewayId}] MQTT service_restart 발행 (requestId=${result?.requestId}, service=${service})`);
        return { success: true, service, via: 'mqtt', output: `MQTT 요청 발행됨 (requestId=${result?.requestId})` };
      } catch (err: any) {
        this.logger.warn(`[${gw.gatewayId}] MQTT restart 실패, SSH로 fallback: ${err.message}`);
      }
    }
    // 2) SSH fallback — config-agent 무응답 또는 MQTT 실패 시
    if (!gw.tunnelPort) {
      return { success: false, service, via: 'ssh', error: 'tunnel_port 미할당 — Pi 터널 비활성' };
    }
    try {
      const { stdout, stderr, code } = await this.sshService.exec(
        gw.tunnelPort,
        `sudo -n systemctl restart ${service} && systemctl is-active ${service}`,
      );
      const ok = code === 0;
      const msg = (stdout || '').trim() + (stderr ? ` | ${stderr.trim()}` : '');
      this.logger.log(`[${gw.gatewayId}] SSH sudo restart ${service} → code=${code} ${msg}`);
      return { success: ok, service, via: 'ssh', output: msg };
    } catch (err: any) {
      this.logger.error(`[${gw.gatewayId}] SSH restart ${service} 실패: ${err.message}`);
      return { success: false, service, via: 'ssh', error: err.message };
    }
  }

  /** gateway 목록에 구역 정보 병합 */
  private async attachGroupInfo(gateways: Gateway[]): Promise<any[]> {
    if (gateways.length === 0) return gateways;
    const houseIds = gateways.map(g => g.houseId).filter(Boolean) as string[];
    if (houseIds.length === 0) return gateways.map(g => ({ ...g, groupId: null, groupName: null }));

    const houses = await this.houseRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.group', 'hg')
      .where('h.id IN (:...houseIds)', { houseIds })
      .getMany();

    const houseToGroup = new Map(houses.map(h => [h.id, { groupId: h.group?.id ?? null, groupName: h.group?.name ?? null }]));
    return gateways.map(g => ({
      ...g,
      groupId: g.houseId ? (houseToGroup.get(g.houseId)?.groupId ?? null) : null,
      groupName: g.houseId ? (houseToGroup.get(g.houseId)?.groupName ?? null) : null,
    }));
  }

  async findAllByUser(userId: string) {
    const gateways = await this.gatewayRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return this.attachGroupInfo(gateways);
  }

  /** 매 분: stale 게이트웨이 상태 자동 오프라인 처리 */
  @Cron(CronExpression.EVERY_MINUTE)
  async resetStaleGatewayStatus() {
    const now = new Date();

    // agent_status: lastSeen > AGENT_STALE_MS 이상 오래된 것 → offline
    const agentStaleThreshold = new Date(now.getTime() - AGENT_STALE_MS);
    const staleAgents = await this.gatewayRepo.find({
      where: [
        { agentStatus: 'online', lastSeen: LessThan(agentStaleThreshold) },
      ],
    });
    for (const gw of staleAgents) {
      await this.gatewayRepo.update({ id: gw.id }, { agentStatus: 'offline', status: 'offline' });
      this.eventsGateway.broadcastGatewayStatus(gw.userId, gw.id, 'offline', 'offline');
      this.logger.warn(`게이트웨이 ${gw.gatewayId}: agent stale → offline (lastSeen: ${gw.lastSeen})`);
    }

    // 게이트웨이 오프라인 → 소속 장치 전체 offline 처리 (self-heal, 멱등).
    // 센서만 stale-리셋되고 액추에이터는 상태 변화 시에만 보고해 자동 offline이 안 되던 갭.
    // 게이트웨이가 죽으면 캐시된 online=true/switchState가 '현재값'처럼 남아 오해를 유발했다.
    // 전환 시점뿐 아니라 '이미 offline인데 online 장치가 남은' 경우도 매 틱 정리하므로,
    // 배포 전부터 오프라인이던 게이트웨이의 stale 장치도 다음 틱에 정리된다.
    // (복구 시엔 z2m availability/장치 보고가 online을 다시 올린다.)
    try {
      const offlineGateways = await this.gatewayRepo.find({ where: { agentStatus: 'offline' } });
      for (const gw of offlineGateways) {
        const offlined: Array<{ id: string; name: string; user_id: string; device_settings: any }> =
          await this.dataSource.query(
            `UPDATE devices SET online = false
             WHERE gateway_id = $1 AND online = true
             RETURNING id::text AS id, name, user_id::text AS user_id, device_settings`,
            [gw.id],
          );
        if (offlined.length === 0) continue;
        this.logger.warn(`게이트웨이 ${gw.gatewayId}(uuid=${gw.id}) 오프라인 → 소속 장치 ${offlined.length}개 offline: ${JSON.stringify(offlined.map(d => ({ id: d.id, name: d.name })))}`);
        for (const d of offlined) {
          const ds = d.device_settings || {};
          this.eventsGateway.broadcastDeviceSwitchUpdate?.(d.user_id, {
            deviceId: d.id,
            switchState: ds.switchState ?? null,
            switchStates: ds.switchStates ?? null,
            online: false,
          });
        }
      }
    } catch (err: any) {
      this.logger.warn(`오프라인 게이트웨이 소속 장치 offline 처리 실패: ${err?.message ?? err}`);
    }

    // tunnel_status: tunnelLastSeen > TUNNEL_STALE_MS 이상 오래된 것 → disconnected
    const tunnelStaleThreshold = new Date(now.getTime() - TUNNEL_STALE_MS);
    const staleTunnels = await this.gatewayRepo.find({
      where: [
        { tunnelStatus: 'connected', tunnelLastSeen: LessThan(tunnelStaleThreshold) },
      ],
    });
    for (const gw of staleTunnels) {
      await this.gatewayRepo.update({ id: gw.id }, { tunnelStatus: 'disconnected' });
      this.logger.warn(`게이트웨이 ${gw.gatewayId}: tunnel stale → disconnected (tunnelLastSeen: ${gw.tunnelLastSeen})`);
    }
  }

  /**
   * gpio-agent 무응답 자동 감지 + restart (매 2분).
   * agent_status=online 인데 gpio/status 가 5분 이상 없으면 1회 자동 restart 발행.
   * cooldown 15분으로 무한 루프 방지.
   */
  @Cron('0 */2 * * * *')
  async autoRecoverGpioAgent() {
    const now = Date.now();
    const onlineGateways = await this.gatewayRepo.find({
      where: { agentStatus: 'online' },
    });
    for (const gw of onlineGateways) {
      const lastGpio = this.gpioStatusLastSeen.get(gw.gatewayId) ?? 0;
      const stalenessMs = now - lastGpio;
      if (lastGpio === 0 || stalenessMs < GPIO_AGENT_STALE_MS) continue;

      const lastRestart = this.lastAutoRestartAt.get(gw.gatewayId) ?? 0;
      if (now - lastRestart < AUTO_RESTART_COOLDOWN_MS) continue;

      this.logger.warn(`[${gw.gatewayId}] gpio-agent 무응답 ${Math.round(stalenessMs / 1000)}s → 자동 restart 시도`);
      this.lastAutoRestartAt.set(gw.gatewayId, now);
      const result = await this.restartPiService(gw, 'gpio-agent');
      this.eventsGateway.sendNotification(gw.userId, {
        type: result.success ? 'gpio_agent_recovered' : 'gpio_agent_recovery_failed',
        title: result.success ? 'gpio-agent 자동 복구' : 'gpio-agent 복구 실패',
        message: result.success
          ? `${gw.name} (${gw.gatewayId}) — gpio-agent 자동 재시작 완료`
          : `${gw.name} (${gw.gatewayId}) — 자동 재시작 실패: ${result.error ?? 'unknown'}`,
      });
    }
  }

  /** admin: 전체 게이트웨이 조회 */
  async findAll() {
    const gateways = await this.gatewayRepo.find({ order: { createdAt: 'DESC' } });
    return this.attachGroupInfo(gateways);
  }

  /** 게이트웨이를 구역(HouseGroup)에 할당 / 해제 */
  async assignZone(id: string, userId: string, role: string, groupId: string | null): Promise<any> {
    const gw = role === 'admin'
      ? await this.gatewayRepo.findOne({ where: { id } })
      : await this.gatewayRepo.findOne({ where: { id, userId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');

    if (groupId === null) {
      // 할당 해제: houseId만 null로 (house 레코드는 보존)
      gw.houseId = null;
      await this.gatewayRepo.save(gw);
      return { ...gw, groupId: null, groupName: null };
    }

    // 이미 다른 구역에 할당된 경우 체크
    if (gw.houseId) {
      const currentHouse = await this.houseRepo.findOne({ where: { id: gw.houseId } });
      if (currentHouse?.groupId && currentHouse.groupId !== groupId) {
        // 현재 구역의 소유자 확인 - 다른 사용자(농장)에 할당된 경우
        const currentGroup = await this.groupRepo.findOne({ where: { id: currentHouse.groupId } });
        if (currentGroup && currentGroup.userId !== gw.userId) {
          throw new ConflictException('이 게이트웨이는 이미 다른 농장의 구역에 할당되어 있습니다. 해당 농장에서 먼저 제거해주세요.');
        }
        // 같은 소유자의 다른 구역이면 재할당 허용
      }
    }

    const group = await this.groupRepo.findOne({
      where: role === 'admin' ? { id: groupId } : { id: groupId, userId },
      relations: ['houses'],
    });
    if (!group) throw new NotFoundException('구역을 찾을 수 없습니다.');

    // 구역의 house 가져오거나 생성
    let house = group.houses[0];
    if (!house) {
      house = await this.houseRepo.save(
        this.houseRepo.create({ userId: group.userId, name: group.name, groupId: group.id }),
      );
    }

    gw.houseId = house.id;
    // 게이트웨이 소유자도 그룹 소유자(농장)로 함께 이관 — 자동제어룰 wizard 등에서
    // user_id 필터로 인해 디바이스가 안 보이는 문제 방지.
    // (이전: admin 으로 등록 후 다른 농장에 할당하면 devices.user_id 가 admin 으로 남아
    //  대상 농장이 로그인해도 자신의 device 로 인식 못 함.)
    const previousOwnerId = gw.userId;
    gw.userId = group.userId;
    await this.gatewayRepo.save(gw);

    // onboard device들의 house_id + user_id 동기화 — 새 zone(house) 매핑 + 새 농장으로 이관
    // (devices.gateway_id / house_id 가 varchar이므로 명시적 cast)
    await this.gatewayRepo.manager.query(
      `UPDATE devices SET house_id = $1::text, user_id = $2 WHERE gateway_id = $3::text AND source = 'onboard'`,
      [house.id, group.userId, gw.id],
    ).catch((e) => {
      this.logger.warn(`onboard device sync 실패 (gateway=${gw.gatewayId}): ${e.message}`);
    });
    if (previousOwnerId !== group.userId) {
      this.logger.log(
        `게이트웨이 소유자 이관 ${gw.gatewayId}: ${previousOwnerId} → ${group.userId} (그룹 ${group.id})`,
      );
    }

    return { ...gw, groupId: group.id, groupName: group.name };
  }

  /** admin: 소유자 변경 포함 업데이트 */
  async updateByAdmin(id: string, data: { name?: string; location?: string; rpiIp?: string; userId?: string; houseId?: string | null }) {
    const gw = await this.gatewayRepo.findOne({ where: { id } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (data.name !== undefined) gw.name = data.name;
    if (data.location !== undefined) gw.location = data.location;
    if (data.rpiIp !== undefined) gw.rpiIp = data.rpiIp;
    if (data.userId !== undefined) gw.userId = data.userId;
    if ('houseId' in data) gw.houseId = data.houseId ?? null;
    return this.gatewayRepo.save(gw);
  }

  async findOne(id: string, userId: string) {
    const gw = await this.gatewayRepo.findOne({ where: { id, userId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    return gw;
  }

  /** role 기반 조회 — admin은 소유권 검사 우회 */
  async findOneByRole(id: string, userId: string, role: string) {
    const where = role === 'admin' ? { id } : { id, userId };
    const gw = await this.gatewayRepo.findOne({ where });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    return gw;
  }

  async findByGatewayId(gatewayId: string) {
    return this.gatewayRepo.findOne({ where: { gatewayId } });
  }

  async create(userId: string, data: { gatewayId: string; name: string; location?: string; rpiIp?: string }) {
    const gateway = this.gatewayRepo.create({ userId, ...data });
    return this.gatewayRepo.save(gateway);
  }

  async update(id: string, userId: string, data: { name?: string; location?: string; rpiIp?: string; userId?: string; houseId?: string | null }) {
    const gw = await this.findOne(id, userId);
    if (data.name !== undefined) gw.name = data.name;
    if (data.location !== undefined) gw.location = data.location;
    if (data.rpiIp !== undefined) gw.rpiIp = data.rpiIp;
    if (data.userId !== undefined) gw.userId = data.userId;
    if ('houseId' in data) gw.houseId = data.houseId ?? null;
    return this.gatewayRepo.save(gw);
  }

  /** 특정 사용자의 게이트웨이 목록 */
  async findAllByUserIds(userIds: string[]) {
    if (userIds.length === 0) return [];
    return this.gatewayRepo
      .createQueryBuilder('gw')
      .where('gw.user_id IN (:...userIds)', { userIds })
      .orderBy('gw.created_at', 'DESC')
      .getMany();
  }

  async remove(id: string, userId: string) {
    const gw = await this.findOne(id, userId);
    const n = await this.cleanupGatewayDevices(gw.id);
    await this.gatewayRepo.remove(gw);
    this.logger.log(`게이트웨이 ${gw.gatewayId} 삭제 — 소속 장치 ${n}개 및 종속 데이터 정리`);
    return { message: '게이트웨이가 삭제되었습니다.' };
  }

  /** admin: 소유자 무관하게 삭제 */
  async removeByAdmin(id: string) {
    const gw = await this.gatewayRepo.findOne({ where: { id } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    const n = await this.cleanupGatewayDevices(gw.id);
    await this.gatewayRepo.remove(gw);
    this.logger.log(`게이트웨이 ${gw.gatewayId} 삭제(admin) — 소속 장치 ${n}개 및 종속 데이터 정리`);
    return { message: '게이트웨이가 삭제되었습니다.' };
  }

  async updateStatus(gatewayId: string, status: string) {
    await this.gatewayRepo.update(
      { gatewayId },
      { status, lastSeen: new Date() },
    );
  }

  async updateZigbeeStatus(gatewayId: string, zigbeeStatus: string) {
    await this.gatewayRepo.update({ gatewayId }, { zigbeeStatus });
  }

  async updateAgentStatus(gatewayId: string, agentStatus: string) {
    // 상태 전환 감지를 위해 이전 상태 보관
    const prev = await this.gatewayRepo.findOne({ where: { gatewayId } });
    const prevStatus = prev?.agentStatus;

    await this.gatewayRepo.update(
      { gatewayId },
      { agentStatus, status: agentStatus, lastSeen: new Date() },
    );
    const gw = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (gw) {
      // 온보드 device들의 online 상태도 동기화
      const isOnline = agentStatus === 'online';
      await this.gatewayRepo.manager.query(
        `UPDATE devices SET online = $1 WHERE gateway_id = $2 AND source = 'onboard'`,
        [isOnline, gw.id],
      );
      this.eventsGateway.broadcastGatewayStatus(gw.userId, gw.id, agentStatus, agentStatus);

      // 재등장 감지: offline → online 전환 시 운영자 알림 + activity log
      if (prevStatus === 'offline' && isOnline) {
        this.logger.log(`게이트웨이 ${gw.gatewayId}: 재등장 감지 (offline → online)`);
        this.eventsGateway.broadcastGatewayRecovered?.(gw.userId, {
          gatewayId: gw.gatewayId,
          name: gw.name,
          rpiIp: gw.rpiIp,
          recoveredAt: new Date().toISOString(),
        });
      }
    }
  }

  /** tunnel_port 채번: 22200~22299 중 미사용 포트 자동 할당 */
  async assignTunnelPort(gatewayId: string): Promise<number> {
    const gw = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    if (gw.tunnelPort) return gw.tunnelPort;

    const used = await this.gatewayRepo
      .createQueryBuilder('gw')
      .select('gw.tunnel_port', 'port')
      .where('gw.tunnel_port IS NOT NULL')
      .getRawMany();
    const usedPorts = new Set(used.map(r => r.port));

    let port: number | null = null;
    for (let p = 22201; p <= 22299; p++) {
      if (!usedPorts.has(p)) { port = p; break; }
    }
    if (!port) throw new Error('할당 가능한 터널 포트가 없습니다 (22201-22299 소진).');

    await this.gatewayRepo.update({ gatewayId }, { tunnelPort: port });
    return port;
  }

  /** Pi 공개키 등록 및 서버 authorized_keys 업데이트 */
  async registerTunnelKey(gatewayId: string, publicKey: string): Promise<{ port: number; serverUser: string }> {
    const gw = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');

    const port = gw.tunnelPort ?? await this.assignTunnelPort(gatewayId);
    await this.gatewayRepo.update({ gatewayId }, { tunnelPublicKey: publicKey });

    // authorized_keys에 추가 (restrict,port-forwarding 옵션)
    const { execSync } = require('child_process');
    const authKeysPath = `${process.env.HOME}/.ssh/authorized_keys`;
    const marker = `# tunnel:${gatewayId}`;
    const entry = `restrict,port-forwarding ${publicKey.trim()} ${marker}`;
    try {
      const existing = execSync(`grep -F "${marker}" ${authKeysPath} 2>/dev/null || echo ""`).toString().trim();
      if (!existing) {
        execSync(`echo '${entry}' >> ${authKeysPath}`);
      } else {
        // 기존 키 교체
        execSync(`sed -i '' '/# tunnel:${gatewayId}/d' ${authKeysPath}`);
        execSync(`echo '${entry}' >> ${authKeysPath}`);
      }
      execSync(`chmod 600 ${authKeysPath}`);
    } catch (e) {
      // authorized_keys 자동 등록 실패 시 수동 등록 필요 — 키는 DB에 저장됨
    }

    return { port, serverUser: process.env.USER || require('os').userInfo().username };
  }

  /** MQTT 터널 상태 업데이트 */
  async updateTunnelStatus(gatewayId: string, status: 'connected' | 'disconnected') {
    await this.gatewayRepo.update(
      { gatewayId },
      {
        tunnelStatus: status,
        tunnelLastSeen: status === 'connected' ? new Date() : undefined,
      },
    );
  }

  /** 터널 연결 중인 게이트웨이 목록 */
  async findAllWithTunnel() {
    return this.gatewayRepo.find({ order: { createdAt: 'DESC' } });
  }
}
