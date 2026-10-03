import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { PushPayload, PushSenderService } from './push-sender.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(DeviceToken) private readonly tokens: Repository<DeviceToken>,
    private readonly sender: PushSenderService,
  ) {}

  /**
   * 앱에서 발급받은 디바이스 토큰 등록(upsert). 같은 토큰이 다른 사용자에게 있으면 재매핑.
   * 앱 기동 시 registration 콜백이 두 번 울려(동시 등록) 중복 키(ux_device_tokens_token)로
   * 500 이 나던 문제가 있어, 토큰 유니크 기준 원자적 upsert + 레이스 대비 재매핑으로 멱등화.
   */
  async registerToken(userId: string, token: string, platform?: string) {
    if (!token) return { ok: false, reason: 'no-token' };
    const plat = platform === 'ios' || platform === 'android' ? platform : 'unknown';
    try {
      // token 유니크 제약 기준 원자적 upsert — 동시 요청이 와도 한쪽은 insert, 한쪽은 update 로 수렴
      await this.tokens.upsert(
        { userId, token, platform: plat },
        { conflictPaths: ['token'] },
      );
      return { ok: true };
    } catch (e) {
      // 혹시 upsert 미지원/경합이 남아 중복 키가 터져도 토큰 매핑만 갱신하고 성공 처리(멱등)
      if (/duplicate key|unique/i.test((e as Error).message)) {
        await this.tokens.update({ token }, { userId, platform: plat });
        return { ok: true, deduped: true };
      }
      throw e;
    }
  }

  async removeToken(token: string) {
    if (token) await this.tokens.delete({ token });
    return { ok: true };
  }

  getTokensForUser(userId: string) {
    return this.tokens.find({ where: { userId } });
  }

  /**
   * 특정 사용자의 모든 기기에 푸시 발송. 무효 토큰은 자동 정리.
   * 자격증명 미설정 시 configured:false 로 반환하고 아무것도 보내지 않음(안전).
   */
  async sendToUser(userId: string, payload: PushPayload) {
    const list = await this.getTokensForUser(userId);
    if (!list.length) {
      return { sent: 0, total: 0, configured: this.sender.isConfigured(), reason: 'no-tokens' };
    }
    const results = await this.sender.send(list, payload);
    const dead = results.filter((r) => r.invalid).map((r) => r.token);
    if (dead.length) {
      await this.tokens.delete({ token: In(dead) });
      this.logger.log(`무효 토큰 ${dead.length}건 정리`);
    }
    return {
      sent: results.filter((r) => r.ok).length,
      total: list.length,
      configured: this.sender.isConfigured(),
      results,
    };
  }
}
