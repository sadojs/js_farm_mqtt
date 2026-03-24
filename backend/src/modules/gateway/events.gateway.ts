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

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('EventsGateway');

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token);
      (client as any).userId = payload.sub;
      this.logger.log(`Client connected: ${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${(client as any).userId || 'unknown'}`);
  }

  @SubscribeMessage('subscribe:house')
  handleSubscribeHouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { houseId: string },
  ) {
    client.join(`house:${data.houseId}`);
  }

  @SubscribeMessage('subscribe:group')
  handleSubscribeGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ) {
    client.join(`group:${data.groupId}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channel: string },
  ) {
    client.leave(data.channel);
  }

  // 센서 데이터 실시간 브로드캐스트
  broadcastSensorUpdate(data: {
    deviceId: string;
    houseId?: string;
    sensorType: string;
    value: number;
    unit: string;
    status: string;
    time: string;
  }) {
    this.server.emit('sensor:update', data);
    if (data.houseId) {
      this.server.to(`house:${data.houseId}`).emit('sensor:update', data);
    }
  }

  // 장비 상태 변경 알림
  broadcastDeviceStatus(deviceId: string, online: boolean) {
    this.server.emit('device:status', { deviceId, online });
  }

  // 자동화 실행 알림
  broadcastAutomationExecuted(data: {
    ruleId: string;
    ruleName: string;
    success: boolean;
    actions: any[];
  }) {
    this.server.emit('automation:executed', data);
  }

  // 일반 알림
  sendNotification(userId: string, notification: {
    type: string;
    title: string;
    message: string;
  }) {
    // 특정 사용자에게 전송
    const sockets = this.server.sockets.sockets;
    sockets.forEach((socket) => {
      if ((socket as any).userId === userId) {
        socket.emit('notification:new', notification);
      }
    });
  }
}
