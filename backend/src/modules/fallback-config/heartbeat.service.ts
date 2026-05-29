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

  constructor(
    private readonly mqtt: MqttService,
    @InjectRepository(Gateway)
    private readonly gatewayRepo: Repository<Gateway>,
  ) {}

  onModuleInit() {
    this.logger.log(
      `서버 하트비트 publisher 시작 (주기: ${HEARTBEAT_INTERVAL_MS}ms)`,
    );
  }

  @Interval('server-heartbeat', HEARTBEAT_INTERVAL_MS)
  async tick() {
    if (!this.mqtt.isConnected()) return;
    try {
      const gateways = await this.gatewayRepo.find({ select: ['gatewayId'] });
      const ts = new Date().toISOString();
      const ids = gateways.map((g) => g.gatewayId).filter(Boolean);
      this.mqtt.publishServerHeartbeatBatch(ids, ts);
    } catch (err: any) {
      this.logger.warn(`heartbeat publish 실패: ${err?.message ?? err}`);
    }
  }
}
