import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { GpioService } from './gpio.service';
import { GpioRelayCommandDto } from './dto/gpio-relay-command.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('gpio')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GpioController {
  constructor(private readonly gpioService: GpioService) {}

  @Post(':gatewayId/relay')
  @Roles('admin', 'farm_admin')
  sendRelayCommand(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: GpioRelayCommandDto,
    @CurrentUser() user: any,
  ) {
    return this.gpioService.sendRelayCommand(gatewayId, user.id, user.role, dto);
  }
}
