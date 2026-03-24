import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAllGroups(@CurrentUser() user: any) {
    return this.groupsService.findAllGroups(this.getEffectiveUserId(user));
  }

  @Get(':id/dependencies')
  getDependencies(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.getDependencies(id, this.getEffectiveUserId(user));
  }

  @Post()
  createGroup(@CurrentUser() user: any, @Body() body: any) {
    return this.groupsService.createGroup(this.getEffectiveUserId(user), body);
  }

  @Put(':id')
  updateGroup(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    return this.groupsService.updateGroup(id, this.getEffectiveUserId(user), body);
  }

  @Delete(':id')
  removeGroup(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.removeGroup(id, this.getEffectiveUserId(user));
  }

  @Get('houses')
  findAllHouses(@CurrentUser() user: any) {
    return this.groupsService.findAllHouses(this.getEffectiveUserId(user));
  }

  @Post('houses')
  createHouse(@CurrentUser() user: any, @Body() body: any) {
    return this.groupsService.createHouse(this.getEffectiveUserId(user), body);
  }

  @Put('houses/:id')
  updateHouse(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    return this.groupsService.updateHouse(id, this.getEffectiveUserId(user), body);
  }

  @Delete('houses/:id')
  removeHouse(@Param('id') id: string, @CurrentUser() user: any) {
    return this.groupsService.removeHouse(id, this.getEffectiveUserId(user));
  }

  @Post(':id/devices')
  assignDevices(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { deviceIds: string[] },
  ) {
    return this.groupsService.assignDevices(id, this.getEffectiveUserId(user), body.deviceIds);
  }

  @Delete(':id/devices/:deviceId')
  removeDeviceFromGroup(
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: any,
  ) {
    return this.groupsService.removeDeviceFromGroup(id, this.getEffectiveUserId(user), deviceId);
  }
}
