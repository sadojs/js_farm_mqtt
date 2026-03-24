import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, UpdateTuyaProjectDto } from './dto/user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // 자기 정보 수정 (모든 인증된 사용자)
  @Put('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateSelf(userId, dto);
  }

  // 자기 Tuya 프로젝트 수정
  @Put('me/tuya')
  updateMyTuya(@CurrentUser('id') userId: string, @Body() dto: UpdateTuyaProjectDto) {
    return this.usersService.updateTuyaProject(userId, dto);
  }

  // 이하 관리자 전용
  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  findAll() {
    return this.usersService.findAll();
  }

  // 팜 관리자 목록 (farm_user 등록 시 소속 선택용) — :id 위에 배치
  @Get('farm-admins')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findFarmAdmins() {
    return this.usersService.findFarmAdmins();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Put(':id/tuya')
  @UseGuards(RolesGuard)
  @Roles('admin')
  updateTuya(@Param('id') id: string, @Body() dto: UpdateTuyaProjectDto) {
    return this.usersService.updateTuyaProject(id, dto);
  }
}
