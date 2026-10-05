import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { EventsGateway } from '../gateway/events.gateway';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { setGatewayLatched } from '../../common/emergency/emergency-latch';

export interface EmergencyActor {
  id: string;
  username: string;
}

/**
 * 비상 정지 — "정지 유지(래치)" 방식.
 *
 *  정지:  DB 기록 → 서버 래치 등록(모든 ON 명령 차단: 수동·자동 룰·관수 스케줄·타이머·방재·음성)
 *         → Pi 에 retained 상태 발행(Pi 도 모든 릴레이 OFF + 해제 전까지 ON 차단, 재부팅 후에도 유지)
 *         → 구형 Pi 호환용 1회 정지 토픽도 함께 발행
 *  해제:  명시적 '정지 해제' 로만 풀린다. 해제 후에도 장비는 꺼진 상태 그대로 — 다시 켜는 것은
 *         자동제어 다음 평가 또는 사용자 조작.
 *  확인:  Pi 가 farm/{gw}/gpio/emergency/state 로 실제 적용 상태를 회신 → piConfirmedAt 기록.
 */
@Injectable()
export class EmergencyStopService implements OnModuleInit {
  private readonly logger = new Logger(EmergencyStopService.name);

  constructor(
    @InjectRepository(Gateway) private readonly gatewayRepo: Repository<Gateway>,
    private readonly mqtt: MqttService,
    private readonly events: EventsGateway,
    private readonly activityLog: ActivityLogService,
  ) {}

  async onModuleInit() {
    // 재시작해도 래치 유지 — DB 가 원본
    try {
      const rows = await this.gatewayRepo
        .createQueryBuilder('g')
        .where(`g.emergency_stop ->> 'active' = 'true'`)
        .getMany();
      for (const gw of rows) setGatewayLatched([gw.gatewayId, gw.id], true);
      if (rows.length) this.logger.warn(`비상 정지 유지 중인 게이트웨이 ${rows.length}대: ${rows.map((g) => g.gatewayId).join(', ')}`);
    } catch (err: any) {
      this.logger.error(`비상 정지 상태 로드 실패: ${err.message}`);
    }
    this.mqtt.setEmergencyStateHandler((gatewayId, payload) => void this.onPiState(gatewayId, payload));
  }

  async status(gatewayId: string) {
    const gw = await this.find(gatewayId);
    return this.view(gw);
  }

  async stop(gatewayId: string, actor: EmergencyActor, reason = 'manual') {
    const gw = await this.find(gatewayId);
    const now = new Date().toISOString();
    gw.emergencyStop = {
      active: true,
      stoppedAt: now,
      stoppedBy: actor.id,
      stoppedByName: actor.username,
      reason,
      piConfirmedAt: null,
      piActive: null,
    };
    await this.gatewayRepo.save(gw);
    setGatewayLatched([gw.gatewayId, gw.id], true);

    // Pi: 유지 상태(retained) + 구형 호환 1회 정지. 브로커 발행 실패해도 서버 래치는 이미 유효(서버발 ON 차단).
    let published = true;
    await this.mqtt.publishEmergencyState(gw.gatewayId, { active: true, by: actor.username, reason, ts: now })
      .catch(() => { published = false; });
    await this.mqtt.publishEmergencyStop(gw.gatewayId, reason, actor.username).catch(() => { published = false; });

    await this.activityLog.log({
      userId: actor.id, userName: actor.username,
      action: 'gateway.emergency_stop', targetType: 'gateway', targetId: gw.id, targetName: gw.name,
      details: { gatewayId: gw.gatewayId, reason, published },
    });
    this.events.sendNotification(gw.userId, {
      type: 'error',
      title: '🛑 비상 정지',
      message: `${gw.name}: 모든 릴레이를 정지했습니다(${actor.username}). '정지 해제' 전까지 자동제어·수동 조작으로 켜지지 않습니다.`,
    });
    this.broadcast(gw);
    this.logger.warn(`비상 정지(유지): ${gw.gatewayId} by ${actor.username} (MQTT ${published ? '발행됨' : '발행 실패'})`);
    return { ...this.view(gw), published };
  }

  async release(gatewayId: string, actor: EmergencyActor) {
    const gw = await this.find(gatewayId);
    if (!gw.emergencyStop?.active) throw new ConflictException('비상 정지 상태가 아닙니다.');
    const now = new Date().toISOString();
    gw.emergencyStop = {
      ...gw.emergencyStop,
      active: false,
      releasedAt: now,
      releasedBy: actor.id,
      releasedByName: actor.username,
      piConfirmedAt: null,
      piActive: null,
    };
    await this.gatewayRepo.save(gw);
    setGatewayLatched([gw.gatewayId, gw.id], false);
    let published = true;
    await this.mqtt.publishEmergencyState(gw.gatewayId, { active: false, by: actor.username, ts: now })
      .catch(() => { published = false; });

    await this.activityLog.log({
      userId: actor.id, userName: actor.username,
      action: 'gateway.emergency_release', targetType: 'gateway', targetId: gw.id, targetName: gw.name,
      details: { gatewayId: gw.gatewayId, published },
    });
    this.events.sendNotification(gw.userId, {
      type: 'warning',
      title: '비상 정지 해제',
      message: `${gw.name}: 비상 정지를 해제했습니다(${actor.username}). 장비는 꺼진 상태이며 자동제어가 다음 평가부터 다시 동작합니다.`,
    });
    this.broadcast(gw);
    return { ...this.view(gw), published };
  }

  /** Pi 회신 — 실제 적용 상태 기록 */
  private async onPiState(gatewayId: string, payload: Buffer) {
    let msg: { active?: boolean; ts?: string };
    try { msg = JSON.parse(payload.toString('utf-8')); } catch { return; }
    const gw = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gw) return;
    gw.emergencyStop = { ...(gw.emergencyStop || { active: false }), piActive: !!msg.active, piConfirmedAt: new Date().toISOString() };
    await this.gatewayRepo.save(gw);
    this.broadcast(gw);
  }

  private broadcast(gw: Gateway) {
    this.events.broadcastEmergencyState?.(gw.userId, { gatewayId: gw.gatewayId, ...this.view(gw) });
  }

  private view(gw: Gateway) {
    const e = gw.emergencyStop || {};
    return {
      active: !!e.active,
      stoppedAt: e.stoppedAt ?? null,
      stoppedByName: e.stoppedByName ?? null,
      reason: e.reason ?? null,
      releasedAt: e.releasedAt ?? null,
      releasedByName: e.releasedByName ?? null,
      // Pi 가 현재 래치 상태를 회신했고 서버 상태와 일치하는지
      piConfirmed: e.piConfirmedAt != null && e.piActive === !!e.active,
      piConfirmedAt: e.piConfirmedAt ?? null,
    };
  }

  private async find(gatewayId: string) {
    const gw = await this.gatewayRepo.findOne({ where: { gatewayId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');
    return gw;
  }
}
