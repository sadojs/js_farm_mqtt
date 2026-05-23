import {
  Controller, Get, Put, Post, Param, Body, UseGuards,
  HttpCode, HttpStatus, Headers, UnauthorizedException, Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigDeployService } from './config-deploy.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdateWifiDto } from './dto/update-wifi.dto';
import { UpdateHostnameDto } from './dto/update-hostname.dto';
import { UpdateGatewayIdDto } from './dto/update-gateway-id.dto';
import { UpdateServerIpDto } from './dto/update-server-ip.dto';
import { UpdateIdentityDto } from './dto/update-identity.dto';
import { RegisterTunnelKeyDto } from './dto/register-tunnel-key.dto';
import {
  CommonConfig, DeployResult, PreviewResult, RemoteConfigAccepted,
} from './config-deploy.types';

@Controller('config-deploy')
export class ConfigDeployController {
  constructor(
    private configDeployService: ConfigDeployService,
    private configService: ConfigService,
  ) {}

  // ---- 템플릿 + Z2M YAML 배포 (legacy, admin only) ----

  @Get('template')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getTemplate(): CommonConfig {
    return this.configDeployService.getTemplate();
  }

  @Put('template')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateTemplate(@Body() config: CommonConfig): CommonConfig {
    return this.configDeployService.updateTemplate(config);
  }

  @Get('gateways/:gatewayId/config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getGatewayConfig(
    @Param('gatewayId') gatewayId: string,
  ): Promise<Record<string, any>> {
    return this.configDeployService.getGatewayConfig(gatewayId);
  }

  @Post('preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  preview(
    @Body() body: { gatewayIds: string[]; config: Record<string, any> },
  ): Promise<PreviewResult[]> {
    return this.configDeployService.previewDeploy(body.gatewayIds, body.config);
  }

  @Post('deploy')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deploy(
    @Body() body: { gatewayIds: string[]; config: Record<string, any> },
  ): Promise<DeployResult[]> {
    return this.configDeployService.deployConfig(body.gatewayIds, body.config);
  }

  // ============================================================
  // MQTT 기반 원격 설정 배포 (rpi-golden-image-system)
  // ============================================================

  @Post(':gatewayId/wifi')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'farm_admin')
  requestWifi(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateWifiDto,
    @Req() req: any,
  ): Promise<RemoteConfigAccepted> {
    return this.configDeployService.requestWifi(
      gatewayId, dto.ssid, dto.password,
      { id: req.user.id, name: req.user.username ?? req.user.name ?? 'unknown' },
    );
  }

  @Post(':gatewayId/hostname')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'farm_admin')
  requestHostname(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateHostnameDto,
    @Req() req: any,
  ): Promise<RemoteConfigAccepted> {
    return this.configDeployService.requestHostname(
      gatewayId, dto.hostname,
      { id: req.user.id, name: req.user.username ?? req.user.name ?? 'unknown' },
    );
  }

  @Post(':gatewayId/gateway-id')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  requestGatewayId(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateGatewayIdDto,
    @Req() req: any,
  ): Promise<RemoteConfigAccepted> {
    return this.configDeployService.requestGatewayId(
      gatewayId, dto.newGatewayId,
      { id: req.user.id, name: req.user.username ?? req.user.name ?? 'unknown' },
    );
  }

  /**
   * rpi-hostname-gateway-id-unify: hostname + gateway-id 통합 변경.
   * 분리 endpoint(/hostname, /gateway-id)는 하위 호환을 위해 유지.
   */
  @Post(':gatewayId/identity')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  requestIdentity(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateIdentityDto,
    @Req() req: any,
  ): Promise<RemoteConfigAccepted> {
    return this.configDeployService.requestIdentity(
      gatewayId, dto.name,
      { id: req.user.id, name: req.user.username ?? req.user.name ?? 'unknown' },
    );
  }

  @Post(':gatewayId/server-ip')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  requestServerIp(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: UpdateServerIpDto,
    @Req() req: any,
  ): Promise<RemoteConfigAccepted> {
    return this.configDeployService.requestServerIp(
      gatewayId, dto.newServerIp,
      { id: req.user.id, name: req.user.username ?? req.user.name ?? 'unknown' },
    );
  }

  // ============================================================
  // First-Boot Bootstrap — Pi가 첫 부팅 시 호출하여 tunnel public key 등록
  // 인증: X-Smartfarm-Bootstrap-Token 헤더 (골든 이미지에 사전 주입된 단일 토큰)
  // ============================================================

  @Post('register-tunnel-key')
  @HttpCode(HttpStatus.OK)
  async registerTunnelKey(
    @Headers('x-smartfarm-bootstrap-token') token: string | undefined,
    @Body() dto: RegisterTunnelKeyDto,
  ): Promise<{ registered: boolean }> {
    const expected = this.configService.get<string>('BOOTSTRAP_TOKEN');
    if (!expected) {
      throw new UnauthorizedException('BOOTSTRAP_TOKEN 미설정 — 서버 환경변수 확인');
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException('잘못된 bootstrap token');
    }
    return this.configDeployService.registerTunnelKey(dto);
  }
}
