import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';

@Injectable()
export class SshProxyService {
  private readonly logger = new Logger(SshProxyService.name);
  private readonly keyPath: string;
  private readonly tunnelUser: string;

  constructor(
    @Inject(forwardRef(() => GatewayManagerService))
    private gatewayService: GatewayManagerService,
  ) {
    this.keyPath = process.env.SSH_TUNNEL_KEY_PATH ?? join(homedir(), '.ssh', 'id_rpi_lgw');
    this.tunnelUser = process.env.SSH_TUNNEL_USER ?? 'lgw-dev';
  }

  private buildConnectConfig(tunnelPort: number) {
    return {
      host: '127.0.0.1',
      port: tunnelPort,
      username: this.tunnelUser,
      privateKey: readFileSync(this.keyPath),
      readyTimeout: 8000,
      keepaliveInterval: 15000,
    };
  }

  async getTunnelPort(gatewayId: string): Promise<number> {
    const gw = await this.gatewayService.findByGatewayId(gatewayId);
    if (!gw?.tunnelPort) throw new Error(`게이트웨이 ${gatewayId}의 터널 포트가 없습니다`);
    return gw.tunnelPort;
  }

  /** 인터랙티브 셸 세션 열기 */
  openShell(
    tunnelPort: number,
    cols: number,
    rows: number,
    onData: (data: string) => void,
    onClose: () => void,
  ): Promise<{
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    destroy: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.shell(
          { term: 'xterm-256color', cols, rows },
          (err, stream) => {
            if (err) { conn.end(); reject(err); return; }

            stream.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')));
            stream.stderr.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')));
            stream.on('close', () => { conn.end(); onClose(); });

            resolve({
              write: (data) => stream.write(data),
              resize: (c, r) => stream.setWindow(r, c, 0, 0),
              destroy: () => conn.end(),
            });
          },
        );
      });

      conn.on('error', (err) => {
        this.logger.error(`SSH 연결 오류 (port:${tunnelPort}): ${err.message}`);
        reject(err);
      });

      conn.connect(this.buildConnectConfig(tunnelPort));
    });
  }

  /** SSH 명령 실행 */
  exec(
    tunnelPort: number,
    command: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let stdout = '';
      let stderr = '';

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { conn.end(); reject(err); return; }

          stream.on('data', (d: Buffer) => { stdout += d.toString(); });
          stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          stream.on('close', (code: number) => {
            conn.end();
            resolve({ stdout, stderr, code: code ?? 0 });
          });
        });
      });

      conn.on('error', reject);
      conn.connect(this.buildConnectConfig(tunnelPort));
    });
  }

  /** SFTP로 파일 업로드 */
  putFile(tunnelPort: number, remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); reject(err); return; }

          const stream = sftp.createWriteStream(remotePath);
          stream.on('close', () => { conn.end(); resolve(); });
          stream.on('error', (e: Error) => { conn.end(); reject(e); });
          stream.end(content, 'utf8');
        });
      });

      conn.on('error', reject);
      conn.connect(this.buildConnectConfig(tunnelPort));
    });
  }
}
