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
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
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
      (client as any).userId = payload.sub;
      this.logger.log(`SSH WS connected: ${payload.sub}`);
    } catch {
      client.disconnect();
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
