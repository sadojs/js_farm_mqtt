import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MqttService } from '../mqtt/mqtt.service';
import { Gateway } from '../gateway-manager/entities/gateway.entity';

const HEARTBEAT_INTERVAL_MS = 10_000;

@Injectable()
export class HeartbeatService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatService.name);

  /** 페일오버 드릴용 전역 중단 스위치. env DISABLE_SERVER_HEARTBEAT=1 로 기동 시 초기 중단. */
  private globalDisabled = process.env.DISABLE_SERVER_HEARTBEAT === '1';
  /** 특정 게이트웨이만 하트비트 제외(해당 Pi 만 폴백 진입 드릴). */
  private readonly disabledGateways = new Set<string>();

  constructor(
    private readonly mqtt: MqttService,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
  ) {}

  onModuleInit() {
    this.logger.log(
      `서버 하트비트 publisher 시작 (주기: ${HEARTBEAT_INTERVAL_MS}ms)` +
        (this.globalDisabled ? ' — 전역 중단 상태로 기동(DISABLE_SERVER_HEARTBEAT)' : ''),
    );
  }

  @Interval('server-heartbeat', HEARTBEAT_INTERVAL_MS)
  async tick() {
    if (this.globalDisabled) return;
    if (!this.mqtt.isConnected()) return;
    try {
      const gateways = await this.gatewayRepo.find({ select: ['gatewayId'] });
      const ts = new Date().toISOString();
      const ids = gateways
        .map((g) => g.gatewayId)
        .filter((id) => Boolean(id) && !this.disabledGateways.has(id));
      if (ids.length === 0) return;
      this.mqtt.publishServerHeartbeatBatch(ids, ts);
    } catch (err: any) {
      this.logger.warn(`heartbeat publish 실패: ${err?.message ?? err}`);
    }
  }

  /** 현재 토글 상태 조회 */
  getStatus() {
    return {
      globalDisabled: this.globalDisabled,
      disabledGateways: [...this.disabledGateways],
      intervalMs: HEARTBEAT_INTERVAL_MS,
    };
  }

  /**
   * 하트비트 발행 토글. gatewayId 미지정이면 전역, 지정 시 해당 게이트웨이만.
   * disabled=true → 중단(Pi 가 서버 단절로 인지 → 폴백 진입), false → 재개.
   */
  setDisabled(disabled: boolean, gatewayId?: string) {
    if (gatewayId) {
      if (disabled) this.disabledGateways.add(gatewayId);
      else this.disabledGateways.delete(gatewayId);
      this.logger.warn(
        `[DRILL] gateway=${gatewayId} 하트비트 ${disabled ? '중단' : '재개'}`,
      );
    } else {
      this.globalDisabled = disabled;
      this.logger.warn(`[DRILL] 전역 하트비트 ${disabled ? '중단' : '재개'}`);
    }
    return this.getStatus();
  }
}
