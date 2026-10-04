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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { House } from '../groups/entities/house.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { FarmContextService } from '../../common/farm-context/farm-context.service';
import { FarmContextCode, FarmContextException } from '../../common/farm-context/farm-context.constants';

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
      // 사용자별 전용 room 자동 입장
      client.join(`user:${payload.sub}`);
      // 플랫폼 관리자(admin)는 별도 'admins' 룸에 입장 — 모든 사용자 데이터 수신
      if (payload.role === 'admin') {
        client.join('admins');
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
  }) {
    this.server.emit('irrigation:started', data);
  }

  // 관수 종료 알림
  emitIrrigationStopped(data: {
    ruleId: string;
    tuyaDeviceId: string;
  }) {
    this.server.emit('irrigation:stopped', data);
  }

  // 게이트웨이 상태 변경 알림
  broadcastGatewayStatus(userId: string, gatewayId: string, status: string, agentStatus: string) {
    this.server.to(`user:${userId}`).emit('gateway:status', { gatewayId, status, agentStatus });
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
    this.server.emit('gpio:status', { gatewayId, ...data });
  }

  // 일반 알림 — 사용자 room 기반으로 전송 (소켓 순회 제거)
  sendNotification(userId: string, notification: {
    type: string;
    title: string;
    message: string;
  }) {
    this.server.to(`user:${userId}`).emit('notification:new', notification);
  }

  // 비 감지 우회 상태 브로드캐스트 (구역 단위)
  broadcastRainOverride(payload: { groupId: string; rainDetected: boolean; userOverride: boolean }) {
    this.server.emit('rain:override', payload);
  }

  // 고온 무대기 강제열림 상태 브로드캐스트 (구역 단위)
  broadcastHighTempOverride(payload: { groupId: string; active: boolean; temperature?: number | null; threshold?: number | null }) {
    this.server.emit('high-temp:override', payload);
  }

  // rpi-emergency-failover: 폴백 모드 전환 브로드캐스트
  broadcastFallbackModeChanged(payload: {
    gatewayId: string;
    mode: 'online' | 'fallback' | 'unknown';
    modeChangedAt: string;
  }) {
    this.server.emit('fallback:mode-changed', payload);
  }

  // rpi-emergency-failover: 폴백 이벤트 발생 시 실시간 알림
  broadcastFallbackEvent(payload: {
    gatewayId: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }) {
    this.server.emit('fallback:event', payload);
  }
}
