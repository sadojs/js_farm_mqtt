import { Controller, Get, Post, Param, Body, Headers, UnauthorizedException, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { GatewayManagerService } from './gateway-manager.service';

/**
 * Pi setup.sh에서 JWT 없이 호출하는 터널 설정 전용 엔드포인트
 * X-Setup-Token 헤더로 gatewayId를 검증
 */
@Controller('gateways')
export class TunnelSetupController {
  constructor(private gatewayService: GatewayManagerService) {}

  /** 터널 설치 스크립트 서빙 — 인증 불필요 */
  @Get('setup/tunnel-setup.sh')
  serveSetupScript(@Res() res: Response) {
    // 로컬 개발: 프로젝트 소스 경로
    const candidates = [
      join(__dirname, '..', '..', '..', '..', 'raspberry-pi', 'tunnel-setup.sh'),
      join(process.cwd(), '..', 'raspberry-pi', 'tunnel-setup.sh'),
      join(process.cwd(), 'raspberry-pi', 'tunnel-setup.sh'),
    ];
    const scriptPath = candidates.find(p => existsSync(p));
    if (!scriptPath) {
      res.status(404).send('# tunnel-setup.sh not found\nexit 1\n');
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="tunnel-setup.sh"');
    res.send(readFileSync(scriptPath, 'utf8'));
  }

  @Get(':gatewayId/tunnel-port')
  async getTunnelPort(
    @Param('gatewayId') gatewayId: string,
    @Headers('x-setup-token') token: string,
  ) {
    if (token !== gatewayId) throw new UnauthorizedException('Invalid setup token');
    const port = await this.gatewayService.assignTunnelPort(gatewayId);
    return { gatewayId, port };
  }

  @Post(':gatewayId/tunnel-key')
  async registerTunnelKey(
    @Param('gatewayId') gatewayId: string,
    @Headers('x-setup-token') token: string,
    @Body() body: { publicKey: string },
  ) {
    if (token !== gatewayId) throw new UnauthorizedException('Invalid setup token');
    return this.gatewayService.registerTunnelKey(gatewayId, body.publicKey);
  }
}
