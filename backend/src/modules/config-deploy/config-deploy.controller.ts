import { Controller, Get, Put, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ConfigDeployService } from './config-deploy.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommonConfig, DeployResult, PreviewResult } from './config-deploy.types';

@Controller('config-deploy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ConfigDeployController {
  constructor(private configDeployService: ConfigDeployService) {}

  /** 공통 설정 템플릿 조회 */
  @Get('template')
  getTemplate(): CommonConfig {
    return this.configDeployService.getTemplate();
  }

  /** 공통 설정 템플릿 수정 */
  @Put('template')
  updateTemplate(@Body() config: CommonConfig): CommonConfig {
    return this.configDeployService.updateTemplate(config);
  }

  /** 특정 게이트웨이의 현재 설정 조회 (MQTT 실시간 요청) */
  @Get('gateways/:gatewayId/config')
  getGatewayConfig(
    @Param('gatewayId') gatewayId: string,
  ): Promise<Record<string, any>> {
    return this.configDeployService.getGatewayConfig(gatewayId);
  }

  /** 배포 미리보기 (현재 설정 vs 변경될 설정 diff) */
  @Post('preview')
  preview(
    @Body() body: { gatewayIds: string[]; config: Record<string, any> },
  ): Promise<PreviewResult[]> {
    return this.configDeployService.previewDeploy(body.gatewayIds, body.config);
  }

  /** 배포 실행 */
  @Post('deploy')
  deploy(
    @Body() body: { gatewayIds: string[]; config: Record<string, any> },
  ): Promise<DeployResult[]> {
    return this.configDeployService.deployConfig(body.gatewayIds, body.config);
  }
}
