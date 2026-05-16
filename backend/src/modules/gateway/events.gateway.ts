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

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
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
    client.leave(data.channel);
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
}
