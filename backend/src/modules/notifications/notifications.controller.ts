import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** 앱: 로그인 후 발급받은 푸시 토큰 등록 (모든 역할 허용 — 각자 기기) */
  @Post('device-token')
  register(@CurrentUser() user: any, @Body() body: { token: string; platform?: string }) {
    return this.service.registerToken(user.id, body?.token, body?.platform);
  }

  /** 앱: 로그아웃/해제 시 토큰 삭제 */
  @Delete('device-token')
  unregister(@Body('token') token: string) {
    return this.service.removeToken(token);
  }

  /** 관리자용 셀프 테스트 — 내 기기로 테스트 푸시 발송 (자격증명 미설정 시 configured:false) */
  @Post('test')
  @UseGuards(RolesGuard)
  @Roles('admin', 'farm_admin')
  sendTest(@CurrentUser() user: any) {
    return this.service.sendToUser(user.id, {
      title: 'SmartFarm 테스트',
      body: '푸시 알림 연결이 정상입니다.',
    });
  }
}
