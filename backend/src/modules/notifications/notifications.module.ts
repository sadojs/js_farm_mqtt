import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushSenderService } from './push-sender.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken])],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushSenderService],
  exports: [NotificationsService], // 다른 모듈(센서알림/자동화)에서 sendToUser 사용 가능
})
export class NotificationsModule {}
