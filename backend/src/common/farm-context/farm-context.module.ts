import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../modules/users/entities/user.entity';
import { FarmContextService } from './farm-context.service';
import { FarmContextInterceptor } from './farm-context.interceptor';

/** 관리자 농장 컨텍스트 — 전역 인터셉터 1곳 + 소켓에서 쓰는 검증 서비스 export */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [FarmContextService, { provide: APP_INTERCEPTOR, useClass: FarmContextInterceptor }],
  exports: [FarmContextService],
})
export class FarmContextModule {}
