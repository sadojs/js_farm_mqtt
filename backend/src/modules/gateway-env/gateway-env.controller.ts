import {
  Body, Controller, Delete, Get, Param, Patch, Post,
  UseGuards,
} from '@nestjs/common';
import { GatewayEnvService } from './gateway-env.service';
import { UpdateOnboardDeviceDto } from './dto/update-onboard-device.dto';
import { CreateOnboardDeviceDto } from './dto/create-onboard-device.dto';
import { AddZigbeeDeviceDto, UpdateZigbeeDeviceDto } from './dto/add-zigbee-device.dto';
import { TestGpioPinDto, TestZigbeeChannelDto } from './dto/test-pin.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('gateway-env')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GatewayEnvController {
  constructor(private readonly svc: GatewayEnvService) {}

  // ── 통합 조회 ────────────────────────────────────────────────

  @Get(':gatewayId/all-devices')
  @Roles('admin', 'farm_admin')
  getAllDevices(@Param('gatewayId') gatewayId: string, @CurrentUser() user: any) {
    return this.svc.getAllDevices(gatewayId, user.id, user.role);
  }

  // ── Onboard ──────────────────────────────────────────────────

  @Get(':gatewayId/onboard')
  @Roles('admin', 'farm_admin')
  getOnboard(@Param('gatewayId') gatewayId: string, @CurrentUser() user: any) {
    return this.svc.getOnboardDevices(gatewayId, user.id, user.role);
  }

  @Post(':gatewayId/onboard')
  @Roles('admin', 'farm_admin')
  createOnboard(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: CreateOnboardDeviceDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.createOnboardDevice(gatewayId, dto, user.id, user.role);
  }

  @Patch(':gatewayId/onboard/:id')
  @Roles('admin', 'farm_admin')
  updateOnboard(
    @Param('gatewayId') gatewayId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardDeviceDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.updateOnboardDevice(gatewayId, id, dto, user.id, user.role);
  }

  @Delete(':gatewayId/onboard/:id')
  @Roles('admin', 'farm_admin')
  deleteOnboard(
    @Param('gatewayId') gatewayId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.deleteOnboardDevice(gatewayId, id, user.id, user.role);
  }

  // ── Zigbee ───────────────────────────────────────────────────

  @Get(':gatewayId/zigbee/scan')
  @Roles('admin', 'farm_admin')
  scanZigbee(@Param('gatewayId') gatewayId: string, @CurrentUser() user: any) {
    return this.svc.scanZigbeeDevices(gatewayId, user.id, user.role);
  }

  @Get(':gatewayId/zigbee')
  @Roles('admin', 'farm_admin')
  getZigbee(@Param('gatewayId') gatewayId: string, @CurrentUser() user: any) {
    return this.svc.getZigbeeDevices(gatewayId, user.id, user.role);
  }

  @Post(':gatewayId/zigbee')
  @Roles('admin', 'farm_admin')
  addZigbee(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: AddZigbeeDeviceDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.addZigbeeDevice(gatewayId, dto, user.id, user.role);
  }

  @Patch(':gatewayId/zigbee/:id')
  @Roles('admin', 'farm_admin')
  updateZigbee(
    @Param('gatewayId') gatewayId: string,
    @Param('id') id: string,
    @Body() dto: UpdateZigbeeDeviceDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.updateZigbeeDevice(gatewayId, id, dto, user.id, user.role);
  }

  @Delete(':gatewayId/zigbee/:id')
  @Roles('admin', 'farm_admin')
  removeZigbee(
    @Param('gatewayId') gatewayId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.removeZigbeeDevice(gatewayId, id, user.id, user.role);
  }

  // ── Irrigation device name ────────────────────────────────────

  @Patch(':gatewayId/irrigation-device-name')
  @Roles('admin', 'farm_admin')
  updateIrrigationDeviceName(
    @Param('gatewayId') gatewayId: string,
    @Body() body: { name: string },
    @CurrentUser() user: any,
  ) {
    return this.svc.updateIrrigationDeviceName(gatewayId, body.name, user.id, user.role);
  }

  // ── Pin Test (admin only) ────────────────────────────────────

  @Post(':gatewayId/pin-test')
  @Roles('admin')
  testGpioPin(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: TestGpioPinDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.testGpioPin(gatewayId, dto.pin, dto.state, dto.durationMs, user.id, user.role);
  }

  @Post(':gatewayId/zigbee-test')
  @Roles('admin')
  testZigbeeChannel(
    @Param('gatewayId') gatewayId: string,
    @Body() dto: TestZigbeeChannelDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.testZigbeeChannel(gatewayId, dto.friendlyName, dto.switchCode, dto.state, dto.durationMs, user.id, user.role);
  }
}
