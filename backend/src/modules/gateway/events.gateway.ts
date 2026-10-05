import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { User } from '../users/entities/user.entity';
import { farmNameOf } from '../users/farm-name.util';
import { FarmContextService } from '../../common/farm-context/farm-context.service';
import { FarmContextCode, FarmContextException } from '../../common/farm-context/farm-context.constants';

/**
 * 플랫폼 관리자 알림 전용 room. 'admins'(데이터 방송용)와 달리 농장 보기(subscribe:farm) 중에도 나가지 않는다.
 * 농장 알림은 이 room 을 제외하고 농장 room 에 보내고, 관리자에게는 농장 이름을 붙인 별도 문구를 보낸다.
 */
const ADMIN_ALERTS_ROOM = 'admin-alerts';

@WebSocketGateway({
  cors: {
    // 기존 웹 오리진 유지 + Capacitor 앱 오리진 추가(하위호환). Plan v2 §5.1.
    origin: [
      process.env.CORS_ORIGIN || 'http://localhost:5174',
      'capacitor://localhost', // iOS 앱
      'https://localhost', // Android 앱 (androidScheme https, 프로덕션)
      'http://localhost', // Android 앱 (androidScheme http, dev 테스트용)
    ],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('EventsGateway');

  constructor(
    private jwtService: JwtService,
    @InjectRepository(House)
    private houseRepository: Repository<House>,
    @InjectRepository(HouseGroup)
    private groupRepository: Repository<HouseGroup>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private farmContext: FarmContextService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token);
      (client as any).userId = payload.sub;
      (client as any).role = payload.role;
      (client as any).parentUserId = payload.parentUserId ?? null;
      // 사용자별 전용 room 자동 입장
      client.join(`user:${payload.sub}`);
      // 농장 사용자는 소속 농장(농장 관리자) room 에도 입장 — 농장 실시간 데이터·알림을 함께 받는다
      // (데이터 소유자가 농장 관리자 id 라 모든 농장 이벤트가 user:<농장 관리자 id> 로 나간다)
      if (payload.role === 'farm_user' && payload.parentUserId) {
        client.join(`user:${payload.parentUserId}`);
      }
      // 플랫폼 관리자(admin)는 별도 'admins' 룸에 입장 — 모든 사용자 데이터 수신
      if (payload.role === 'admin') {
        client.join('admins');
        client.join(ADMIN_ALERTS_ROOM);
      }
      this.logger.log(`Client connected: ${payload.sub} (role=${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${(client as any).userId || 'unknown'}`);
  }

  @SubscribeMessage('subscribe:house')
  async handleSubscribeHouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { houseId: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.houseId) {
      client.emit('error', { message: 'Invalid request' });
      return;
    }

    // houseId 소유권 검증: DB에서 해당 house가 userId 소유인지 확인
    const house = await this.houseRepository.findOne({
      where: { id: data.houseId, userId },
    });

    if (!house) {
      this.logger.warn(`Unauthorized subscribe:house attempt — userId=${userId}, houseId=${data.houseId}`);
      client.emit('error', { message: 'Unauthorized: house not found or access denied' });
      return;
    }

    client.join(`house:${data.houseId}`);
  }

  @SubscribeMessage('subscribe:group')
  async handleSubscribeGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    const userId = (client as any).userId;
    if (!userId || !data?.groupId) {
      client.emit('error', { message: 'Invalid request' });
      return;
    }

    const group = await this.groupRepository.findOne({
      where: { id: data.groupId, userId },
    });

    if (!group) {
      this.logger.warn(`Unauthorized subscribe:group attempt — userId=${userId}, groupId=${data.groupId}`);
      client.emit('error', { message: 'Unauthorized: group not found or access denied' });
      return;
    }

    client.join(`group:${data.groupId}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channel: string },
  ) {
    // 관리자 농장 컨텍스트 퇴장 (옵트인). 'farm' 이외 채널은 기존 동작 그대로.
    if (data?.channel === 'farm') return this.leaveFarm(client);
    client.leave(data.channel);
  }

  /**
   * 관리자 농장 컨텍스트 (옵트인) — admin 소켓이 선택한 농장 이벤트만 받도록 room 을 바꾼다.
   * 기존 클라이언트는 이 이벤트를 보내지 않으므로 영향 없음.
   * 성공: admins room 퇴장 + user:<farmId> 입장 → farm:joined. 실패: farm:error (room 변화 없음).
   * ack 콜백이 있으면 { ok, farmId } / { ok:false, code, message } 로도 응답.
   */
  @SubscribeMessage('subscribe:farm')
  async handleSubscribeFarm(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { farmId?: string },
  ) {
    const fail = (e: FarmContextException) => {
      const payload = e.toPayload();
      client.emit('farm:error', payload);
      return { ok: false, ...payload };
    };
    if ((client as any).role !== 'admin') {
      this.logger.warn(`Unauthorized subscribe:farm — userId=${(client as any).userId}`);
      return fail(new FarmContextException(FarmContextCode.FORBIDDEN));
    }
    let farm: { id: string };
    try {
      farm = await this.farmContext.resolveFarm(String(data?.farmId ?? '').trim());
    } catch (e) {
      if (e instanceof FarmContextException) return fail(e);
      throw e;
    }
    const prev: string | undefined = client.data?.farmId;
    if (prev && prev !== farm.id) client.leave(`user:${prev}`);
    client.leave('admins');
    client.join(`user:${farm.id}`);
    client.data.farmId = farm.id;
    client.emit('farm:joined', { farmId: farm.id });
    return { ok: true, farmId: farm.id };
  }

  private leaveFarm(client: Socket) {
    const farmId: string | null = client.data?.farmId ?? null;
    if (farmId) client.leave(`user:${farmId}`);
    if (client.data) client.data.farmId = undefined;
    if ((client as any).role === 'admin') client.join('admins');
    client.emit('farm:left', { farmId });
    return { ok: true, farmId };
  }

  // 센서 데이터 — 해당 사용자 room + house room + admins 룸으로 전송
  broadcastSensorUpdate(
    userId: string,
    data: {
      deviceId: string;
      houseId?: string;
      sensorType: string;
      value: number;
      unit: string;
      status: string;
      time: string;
    },
  ) {
    this.server.to(`user:${userId}`).emit('sensor:update', data);
    if (data.houseId) {
      this.server.to(`house:${data.houseId}`).emit('sensor:update', data);
    }
    // 플랫폼 관리자도 모든 센서 업데이트 수신
    this.server.to('admins').emit('sensor:update', data);
  }

  // 장비 상태 — 해당 사용자 room + admins 룸으로 전송
  broadcastDeviceStatus(userId: string, deviceId: string, online: boolean) {
    this.server.to(`user:${userId}`).emit('device:status', { deviceId, online });
    this.server.to('admins').emit('device:status', { deviceId, online });
  }

  /**
   * 장비 스위치 상태 갱신 — 룰이 발행한 GPIO 토글이 구역관리 카드/관수 모달에 실시간 반영.
   * frontend는 'device:switch-update' 이벤트로 switchState/switchStates를 store에 적용.
   */
  broadcastDeviceSwitchUpdate(userId: string, data: {
    deviceId: string;
    switchState: boolean | null;
    switchStates?: Record<string, boolean> | null;
    online?: boolean;
  }) {
    this.server.to(`user:${userId}`).emit('device:switch-update', data);
    this.server.to('admins').emit('device:switch-update', data);
  }

  // 자동화 실행 알림 — 해당 사용자 room으로만 전송
  broadcastAutomationExecuted(
    userId: string,
    data: {
      ruleId: string;
      ruleName: string;
      success: boolean;
      actions: any[];
    },
  ) {
    this.server.to(`user:${userId}`).emit('automation:executed', data);
  }

  /**
   * device-replacement: 장치 교체 완료 broadcast.
   * Frontend는 deviceStore.refreshById()로 영향 받은 device row(들)을 자동 갱신.
   */
  broadcastDeviceReplaced(userId: string, data: {
    deviceId: string;
    oldIeee: string;
    newIeee: string;
    gatewayId?: string;
    preservedRules: number;
    pairedDeviceId?: string | null;
    childrenIds?: string[];
  }) {
    this.server.to(`user:${userId}`).emit('device:replaced', data);
    this.server.to('admins').emit('device:replaced', data);
  }

  // 관수 시작 알림
  emitIrrigationStarted(data: {
    ruleId: string;
    ruleName: string;
    deviceId: string;
    tuyaDeviceId: string;
    startedAt: number;
    estimatedEndAt: number;
    userId?: string;
  }) {
    const { userId, ...payload } = data;
    this.emitToFarm(userId ?? null, 'irrigation:started', payload);
  }

  // 관수 종료 알림
  emitIrrigationStopped(data: {
    ruleId: string;
    tuyaDeviceId: string;
    userId?: string;
  }) {
    const { userId, ...payload } = data;
    this.emitToFarm(userId ?? null, 'irrigation:stopped', payload);
  }

  /**
   * 농장 데이터 이벤트 — 그 농장 room(농장 관리자·소속 사용자·농장 보기 중인 관리자) + 플랫폼 관리자.
   * (이전: 전체 방송 — 다른 농장 접속자에게도 룰 이름·장치 ID·이벤트가 전달됨)
   * 소유자를 알 수 없으면 관리자에게만 보낸다.
   */
  private emitToFarm(ownerId: string | null, event: string, payload: unknown) {
    if (ownerId) this.server.to(`user:${ownerId}`).to('admins').emit(event, payload);
    else this.server.to('admins').emit(event, payload);
  }

  private async ownerOfGateway(gatewayRef: string): Promise<string | null> {
    try {
      const [row] = await this.userRepository.manager.query(
        'SELECT user_id::text AS user_id FROM gateways WHERE gateway_id = $1 OR id::text = $1 LIMIT 1', [gatewayRef]);
      return row?.user_id ?? null;
    } catch { return null; }
  }

  private async ownerOfGroup(groupId: string): Promise<string | null> {
    try {
      const g = await this.groupRepository.findOne({ where: { id: groupId } });
      return (g as any)?.userId ?? null;
    } catch { return null; }
  }

  // 게이트웨이 상태 변경 알림
  broadcastGatewayStatus(userId: string, gatewayId: string, status: string, agentStatus: string) {
    // 농장 + 플랫폼 관리자 (이전: 농장 room 만 → 관리자 화면은 마지막 신호 시각이 갱신되지 않아 5분 뒤 '오프라인'으로 보임)
    this.emitToFarm(userId, 'gateway:status', { gatewayId, status, agentStatus });
  }

  // 게이트웨이 재등장 알림 (offline → online 전환 시)
  broadcastGatewayRecovered(userId: string, data: {
    gatewayId: string; name: string; rpiIp?: string | null; recoveredAt: string;
  }) {
    this.server.to(`user:${userId}`).emit('gateway:recovered', data);
    // 일반 알림 채널에도 함께 보내 토스트 표시 가능
    this.sendNotification(userId, {
      type: 'gateway_recovered',
      title: '게이트웨이 복구',
      message: `${data.name} (${data.gatewayId})${data.rpiIp ? ' — ' + data.rpiIp : ''} 가 다시 온라인 상태입니다.`,
    });
  }

  // GPIO 핀 상태 브로드캐스트 (admin 핀 테스트 실시간 피드백)
  broadcastGpioStatus(gatewayId: string, data: { slot: string; pin: number; state: boolean; auto?: boolean }) {
    void this.ownerOfGateway(gatewayId).then((owner) => this.emitToFarm(owner, 'gpio:status', { gatewayId, ...data }));
  }

  /** 계정 비활성화·삭제 → 그 계정의 실시간 접속 종료 (농장 관리자면 소속 농장 사용자 접속도) */
  @OnEvent('user.sessions.revoked')
  disconnectUser(payload: { userId: string }) {
    for (const sock of this.server.sockets.sockets.values()) {
      const c = sock as any;
      if (c.role === 'admin') continue;
      if (c.userId === payload.userId || c.parentUserId === payload.userId) sock.disconnect(true);
    }
  }

  /**
   * 일반 알림 — 받는 사람에 따라 문구를 나눈다.
   *  - 농장(농장 관리자 room): 원래 문구 그대로. 플랫폼 관리자 소켓은 제외(농장 보기 중이라 같은 room 에 있어도).
   *  - 플랫폼 관리자(admin-alerts room): 어느 농장의 문제인지 농장 이름·담당 계정을 붙인 문구 + farmId.
   */
  sendNotification(userId: string, notification: {
    type: string;
    title: string;
    message: string;
  }) {
    this.server.to(`user:${userId}`).except(ADMIN_ALERTS_ROOM).emit('notification:new', notification);
    void this.sendAdminNotification(userId, notification);
  }

  private async sendAdminNotification(ownerId: string, n: { type: string; title: string; message: string }) {
    try {
      const owner = await this.userRepository.findOne({ where: { id: ownerId } });
      const farm = owner ? farmNameOf(owner) : null;
      const who = owner ? (owner.role === 'farm_admin' ? `관리자 ${owner.name} @${owner.username}` : `@${owner.username}`) : '';
      this.server.to(ADMIN_ALERTS_ROOM).emit('notification:new', {
        type: n.type,
        title: farm ? `[${farm}] ${n.title}` : n.title,
        message: farm ? `${farm} 농장(${who}) — ${n.message}` : n.message,
        farmId: owner?.role === 'farm_admin' ? owner.id : null,
        farmName: farm,
        scope: 'platform',
      });
    } catch (e) {
      this.logger.error(`[Admin Notify] 관리자 알림 전송 실패: ${(e as Error).message}`);
    }
  }

  // 비 감지 우회 상태 브로드캐스트 (구역 단위)
  broadcastRainOverride(payload: { groupId: string; rainDetected: boolean; userOverride: boolean }) {
    void this.ownerOfGroup(payload.groupId).then((owner) => this.emitToFarm(owner, 'rain:override', payload));
  }

  // 고온 무대기 강제열림 상태 브로드캐스트 (구역 단위)
  broadcastHighTempOverride(payload: { groupId: string; active: boolean; temperature?: number | null; threshold?: number | null }) {
    void this.ownerOfGroup(payload.groupId).then((owner) => this.emitToFarm(owner, 'high-temp:override', payload));
  }

  /** 비상 정지 유지 상태 변경 — 해당 농장 + 관리자 */
  broadcastEmergencyState(ownerId: string, payload: Record<string, unknown>) {
    this.emitToFarm(ownerId, 'emergency:state', payload);
  }

  // rpi-emergency-failover: 폴백 모드 전환 브로드캐스트
  broadcastFallbackModeChanged(payload: {
    gatewayId: string;
    mode: 'online' | 'fallback' | 'unknown';
    modeChangedAt: string;
  }) {
    void this.ownerOfGateway(payload.gatewayId).then((owner) => this.emitToFarm(owner, 'fallback:mode-changed', payload));
  }

  // rpi-emergency-failover: 폴백 이벤트 발생 시 실시간 알림
  broadcastFallbackEvent(payload: {
    gatewayId: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }) {
    void this.ownerOfGateway(payload.gatewayId).then((owner) => this.emitToFarm(owner, 'fallback:event', payload));
  }
}
