import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity';
import { EventsGateway } from '../gateway/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * 명령 반영 확인 (검토 §7-9 ②).
 *
 * 켜기/끄기 명령을 보낸 뒤 장치가 실제 상태를 보고하는지 기다린다.
 *  - Zigbee: z2m 이 보내는 상태 메시지의 state(ON/OFF)
 *  - Pi 온보드 릴레이: gpio-agent 의 gpio/status (rejected 면 즉시 실패)
 * 보고가 없으면 같은 명령을 다시 보내고(최대 3회), 그래도 안 되면 "명령 미반영" 알림을 보낸다.
 * 같은 장치에 새 명령이 오면 이전 확인은 취소한다(새 명령이 이긴다).
 *
 * 대상: 팬·개폐기 같은 단일 스위치 장치만. 관수(다채널)·하위 채널 장치는 제외.
 */

export const ACK_WAIT_MS = Number(process.env.COMMAND_ACK_WAIT_MS) || 10_000;
export const ACK_MAX_RETRIES = 3;
/** 같은 장치의 미반영 알림은 이 시간 안에 다시 보내지 않는다 */
const ALERT_COOLDOWN_MS = 10 * 60_000;

interface Pending {
  deviceId: string;
  name: string;
  userId: string;
  on: boolean;
  retries: number;
  resend: () => Promise<void>;
  timer: ReturnType<typeof setTimeout> | null;
}

@Injectable()
export class CommandAckService implements OnModuleDestroy {
  private readonly logger = new Logger(CommandAckService.name);
  private readonly pending = new Map<string, Pending>();
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    @InjectRepository(Device) private readonly devicesRepo: Repository<Device>,
    private readonly eventsGateway: EventsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleDestroy() {
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
  }

  /** 명령을 보냈다 — 상태 보고를 기다린다 */
  expect(device: { id: string; name: string; userId: string }, on: boolean, resend: () => Promise<void>) {
    this.cancel(device.id);
    const p: Pending = { deviceId: device.id, name: device.name, userId: device.userId, on, retries: 0, resend, timer: null };
    this.pending.set(device.id, p);
    this.arm(p);
  }

  /** 새 명령 등으로 확인을 그만둔다 */
  cancel(deviceId: string) {
    const p = this.pending.get(deviceId);
    if (p?.timer) clearTimeout(p.timer);
    this.pending.delete(deviceId);
  }

  isPending(deviceId: string) {
    return this.pending.has(deviceId);
  }

  private arm(p: Pending) {
    p.timer = setTimeout(() => { this.onTimeout(p).catch(() => undefined); }, ACK_WAIT_MS);
  }

  private async onTimeout(p: Pending) {
    if (this.pending.get(p.deviceId) !== p) return; // 이미 다른 명령으로 바뀜
    if (p.retries >= ACK_MAX_RETRIES) {
      this.pending.delete(p.deviceId);
      await this.fail(p, `${p.on ? '켜기' : '끄기'} 명령을 ${ACK_MAX_RETRIES + 1}번 보냈지만 장치가 응답하지 않았습니다. 전원과 통신 상태를 확인해 주세요.`);
      return;
    }
    p.retries += 1;
    this.logger.warn(`[ack] ${p.name} 응답 없음 → 다시 보냄 ${p.retries}/${ACK_MAX_RETRIES}`);
    try {
      await p.resend();
    } catch (err: any) {
      this.logger.warn(`[ack] ${p.name} 재전송 실패: ${err?.message ?? err}`);
    }
    if (this.pending.get(p.deviceId) === p) this.arm(p);
  }

  /** 장치가 상태를 보고했다 (MQTT 핸들러가 보냄) */
  @OnEvent('device.state_reported')
  async onReport(e: { deviceId: string; on: boolean; rejected?: string }) {
    const p = this.pending.get(e.deviceId);
    if (!p) return;
    if (e.rejected) {
      this.cancel(e.deviceId);
      const why = e.rejected === 'emergency-latched' ? '비상 정지 중이라 장치가 명령을 거부했습니다.' : `장치가 명령을 거부했습니다(${e.rejected}).`;
      await this.fail(p, why);
      return;
    }
    if (e.on !== p.on) return; // 다른 상태 보고(예: 인터록 OFF) — 계속 기다린다
    this.cancel(e.deviceId);
    if (p.retries > 0) this.logger.log(`[ack] ${p.name} 재전송 ${p.retries}회 만에 반영됨`);
    await this.setFlag(e.deviceId, null);
  }

  private async fail(p: Pending, message: string) {
    this.logger.warn(`[ack] ${p.name} 명령 미반영 — ${message}`);
    await this.setFlag(p.deviceId, { at: new Date().toISOString(), on: p.on });
    const last = this.lastAlertAt.get(p.deviceId) ?? 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(p.deviceId, Date.now());
    const title = `⚠ ${p.name} 명령 미반영`;
    try { this.eventsGateway.sendNotification(p.userId, { type: 'error', title, message }); } catch { /* 무시 */ }
    try {
      await this.notifications.sendToFarm(p.userId, { title, body: message, data: { type: 'command_unconfirmed', deviceId: p.deviceId } });
    } catch (err: any) {
      this.logger.warn(`[ack] 푸시 실패: ${err?.message ?? err}`);
    }
  }

  /** 장치 카드의 "미반영" 표시 — null 이면 지운다 */
  private async setFlag(deviceId: string, flag: { at: string; on: boolean } | null) {
    const dev = await this.devicesRepo.findOne({ where: { id: deviceId } });
    if (!dev) return;
    const s: any = dev.deviceSettings || {};
    if (!flag && !s.commandUnconfirmed) return;
    if (flag) s.commandUnconfirmed = flag; else delete s.commandUnconfirmed;
    dev.deviceSettings = s;
    await this.devicesRepo.save(dev).catch(() => undefined);
    this.eventsGateway.broadcastDeviceSwitchUpdate?.(dev.userId, {
      deviceId: dev.id,
      switchState: s.switchState ?? null,
      switchStates: s.switchStates ?? null,
      online: dev.online,
      commandUnconfirmed: flag,
    } as any);
  }
}
