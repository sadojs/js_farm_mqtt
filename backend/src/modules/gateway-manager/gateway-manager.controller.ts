import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { GatewayManagerService } from './gateway-manager.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('gateways')
@UseGuards(JwtAuthGuard)
export class GatewayManagerController {
  constructor(private gatewayService: GatewayManagerService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.gatewayService.findAllByUser(this.getEffectiveUserId(user));
  }

  @Post()
  create(
    @CurrentUser() user: any,
    @Body() body: { gatewayId: string; name: string; location?: string; rpiIp?: string },
  ) {
    return this.gatewayService.create(this.getEffectiveUserId(user), body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { name?: string; location?: string; rpiIp?: string },
  ) {
    return this.gatewayService.update(id, this.getEffectiveUserId(user), body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.gatewayService.remove(id, this.getEffectiveUserId(user));
  }
}
