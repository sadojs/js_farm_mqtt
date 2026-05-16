import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Gateway } from './entities/gateway.entity';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { EventsGateway } from '../gateway/events.gateway';

/** agentStatus/tunnelStatus 갱신 없이 이 시간이 지나면 오프라인으로 간주 (ms) */
const AGENT_STALE_MS = 5 * 60 * 1000;    // 5분
const TUNNEL_STALE_MS = 3 * 60 * 1000;   // 3분

@Injectable()
export class GatewayManagerService {
  private readonly logger = new Logger(GatewayManagerService.name);

  constructor(
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    @InjectRepository(House) private houseRepo: Repository<House>,
    @InjectRepository(HouseGroup) private groupRepo: Repository<HouseGroup>,
    private eventsGateway: EventsGateway,
  ) {}

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
    await this.gatewayRepo.save(gw);
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
    await this.gatewayRepo.remove(gw);
    return { message: '게이트웨이가 삭제되었습니다.' };
  }

  /** admin: 소유자 무관하게 삭제 */
  async removeByAdmin(id: string) {
    const gw = await this.gatewayRepo.findOne({ where: { id } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    await this.gatewayRepo.remove(gw);
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
