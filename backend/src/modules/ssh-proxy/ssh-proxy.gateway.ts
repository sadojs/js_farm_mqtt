import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { SshProxyService } from './ssh-proxy.service';

interface ShellSession {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  destroy: () => void;
}

@WebSocketGateway({
  namespace: '/ssh',
  cors: { origin: '*', credentials: true },
})
export class SshProxyGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(SshProxyGateway.name);
  private readonly sessions = new Map<string, ShellSession>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly sshService: SshProxyService,
    private readonly dataSource: DataSource,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify(token);
      if (!['admin', 'farm_admin'].includes(payload.role)) {
        client.disconnect();
        return;
      }
      // 비활성화된 계정은 접속 거부 (토큰이 아직 만료 전이어도)
      const [row] = await this.dataSource.query('SELECT status FROM users WHERE id::text = $1', [payload.sub]);
      if (!row || row.status !== 'active') {
        client.disconnect();
        return;
      }
      (client as any).userId = payload.sub;
      (client as any).role = payload.role;
      this.logger.log(`SSH WS connected: ${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  /** 계정 비활성화·삭제 → 열린 터미널 세션 즉시 종료 */
  @OnEvent('user.sessions.revoked')
  closeUserShells(payload: { userId: string }) {
    const nsp: any = this.server;
    const sockets: Map<string, Socket> = nsp?.sockets instanceof Map ? nsp.sockets : nsp?.sockets?.sockets;
    if (!sockets) return;
    for (const sock of sockets.values()) {
      if ((sock as any).userId === payload.userId) {
        this.sessions.get(sock.id)?.destroy();
        this.sessions.delete(sock.id);
        sock.disconnect(true);
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.sessions.get(client.id)?.destroy();
    this.sessions.delete(client.id);
    this.logger.log(`SSH WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('connect_shell')
  async handleConnectShell(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gatewayId: string; cols?: number; rows?: number },
  ) {
    try {
      // 소유권: 플랫폼 관리자는 전체, 농장 관리자는 자기 농장 게이트웨이만 (이전: 아무 게이트웨이 셸이나 열림)
      if ((client as any).role !== 'admin') {
        const [gw] = await this.dataSource.query(
          'SELECT user_id::text AS user_id FROM gateways WHERE gateway_id = $1 LIMIT 1', [data?.gatewayId]);
        if (!gw || gw.user_id !== String((client as any).userId)) {
          client.emit('error', { message: '이 게이트웨이에 대한 권한이 없습니다.' });
          return;
        }
      }
      const port = await this.sshService.getTunnelPort(data.gatewayId);
      const session = await this.sshService.openShell(
        port,
        data.cols ?? 80,
        data.rows ?? 24,
        (chunk) => client.emit('data', chunk),
        () => {
          client.emit('exit');
          this.sessions.delete(client.id);
        },
      );
      this.sessions.set(client.id, session);
      client.emit('ready');
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('data')
  handleData(@ConnectedSocket() client: Socket, @MessageBody() data: string) {
    this.sessions.get(client.id)?.write(data);
  }

  @SubscribeMessage('resize')
  handleResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { cols: number; rows: number },
  ) {
    this.sessions.get(client.id)?.resize(data.cols, data.rows);
  }
}
