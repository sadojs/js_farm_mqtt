import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GatewayManagerService } from '../gateway-manager/gateway-manager.service';
import { EventsGateway } from '../gateway/events.gateway';
import { ZigbeeDevice } from './mqtt.types';
import { Device } from '../devices/entities/device.entity';
import { GatewayOnboardDevice } from '../gateway-env/entities/gateway-onboard-device.entity';

@Injectable()
export class MqttBridgeHandler {
  private readonly logger = new Logger(MqttBridgeHandler.name);

  /** 게이트웨이별 Zigbee 장비 목록 캐시 */
  private deviceCache = new Map<string, ZigbeeDevice[]>();
  private devicesListeners: Array<(gatewayId: string) => void> = [];

  constructor(
    @Inject(forwardRef(() => GatewayManagerService))
    private gatewayService: GatewayManagerService,
    private eventsGateway: EventsGateway,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(GatewayOnboardDevice) private onboardRepo: Repository<GatewayOnboardDevice>,
  ) {}

  async handleBridgeState(gatewayId: string, payload: Buffer) {
    let data: { state: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }

    await this.gatewayService.updateZigbeeStatus(gatewayId, data.state);
    this.logger.log(`게이트웨이 ${gatewayId} Zigbee → ${data.state}`);
  }

  async handleAgentStatus(gatewayId: string, payload: Buffer) {
    let data: { status: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }

    await this.gatewayService.updateAgentStatus(gatewayId, data.status);
    this.logger.log(`게이트웨이 ${gatewayId} Agent → ${data.status}`);
  }

  async handleBridgeDevices(gatewayId: string, payload: Buffer) {
    let devices: ZigbeeDevice[];
    try {
      const parsed = JSON.parse(payload.toString());
      // bridge/devices → 배열 직접, bridge/response/devices → { data: [...], status: 'ok' }
      devices = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
    } catch {
      return;
    }
    if (devices.length === 0) return;

    // Coordinator 제외하고 캐시에 저장
    const filtered = devices.filter(d => d.type !== 'Coordinator');
    this.deviceCache.set(gatewayId, filtered);
    this.logger.log(`게이트웨이 ${gatewayId}: ${filtered.length}개 Zigbee 장비 캐시됨`);

    // 대기 중인 리스너에게 알림
    this.devicesListeners.forEach(fn => fn(gatewayId));
  }

  async handleTunnelStatus(gatewayId: string, payload: Buffer) {
    let data: { status: 'connected' | 'disconnected' };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    await this.gatewayService.updateTunnelStatus(gatewayId, data.status);
    this.logger.log(`게이트웨이 ${gatewayId} 터널 → ${data.status}`);
  }

  async handleGpioStatus(gatewayId: string, payload: Buffer) {
    let data: { slot: string; pin: number; state: boolean; auto?: boolean; timestamp: string };
    try {
      data = JSON.parse(payload.toString());
    } catch {
      return;
    }
    this.logger.log(
      `GPIO 상태 [${gatewayId}] ${data.slot}: BCM ${data.pin} → ${data.state ? 'HIGH' : 'LOW'}${data.auto ? ' (자동해제)' : ''}`,
    );
    // 자동 복구 cron이 사용할 마지막 수신 시각 기록
    this.gatewayService.recordGpioStatus(gatewayId);
    // UUID로 변환하여 브로드캐스트 (프론트엔드는 URL param UUID 기준)
    const gw = await this.gatewayService.findByGatewayId(gatewayId);
    this.eventsGateway.broadcastGpioStatus(gw?.id ?? gatewayId, {
      slot: data.slot, pin: data.pin, state: data.state, auto: data.auto,
    });

    // 슬롯에 매핑된 device의 switchState/switchStates를 DB에 반영 + 변경 이벤트.
    // 룰이 발행한 GPIO 토글이 구역관리 카드/관수 모달에 실시간 반영되도록 함.
    if (gw) {
      try {
        const slot = await this.onboardRepo.findOne({ where: { slotKey: data.slot, gatewayId: gw.id } as any });
        if (slot) {
          // 1차: onboard_device_id 1:1 매핑 (fan, opener_open/close)
          let device = await this.deviceRepo.findOne({ where: { onboardDeviceId: slot.id } as any });
          // 2차: irrigation은 1 device가 여러 slot에 매핑 — onboard_device_id 없음 → gateway+source+equipment_type로 찾기
          if (!device) {
            const IRRIGATION_SLOT_TYPES = new Set(['remote_control', 'fertilizer_contact', 'irrigation_zone', 'mixer', 'fertilizer_motor']);
            if (IRRIGATION_SLOT_TYPES.has(slot.slotType)) {
              device = await this.deviceRepo.findOne({
                where: { gatewayId: gw.id, source: 'onboard', equipmentType: 'irrigation' } as any,
              });
            }
          }
          if (device) {
            const settings: any = device.deviceSettings || {};
            if (device.equipmentType === 'irrigation') {
              // 관수: switchStates 다중 키 갱신 (channelMapping의 mapping value = relay_<slotKey>)
              const switchStates = { ...(settings.switchStates || {}) };
              switchStates[`relay_${data.slot}`] = data.state;
              settings.switchStates = switchStates;
            } else if (
              (device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close') &&
              !data.state &&
              settings.relayActivePhase  // 룰 펄스 사이클 active 중
            ) {
              // 개폐기 + relay 룰 active phase 펄스 OFF는 sticky ON 유지
              // (펄스 30s ON / 60s OFF 동안 화면이 깜박이지 않도록)
              this.logger.debug(`[GPIO] ${device.name} 펄스 OFF skip (룰 active phase 유지)`);
              return;
            } else {
              // 유동팬/개폐기: 단일 switchState 저장 (frontend가 보는 키)
              settings.switchState = data.state;
            }
            device.deviceSettings = settings;
            await this.deviceRepo.save(device);
            this.eventsGateway.broadcastDeviceSwitchUpdate(device.userId, {
              deviceId: device.id,
              switchState: settings.switchState ?? null,
              switchStates: settings.switchStates ?? null,
              online: device.online,
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`GPIO 상태 device 동기화 실패 (slot=${data.slot}): ${err?.message ?? err}`);
      }
    }
  }

  /** 특정 게이트웨이의 Zigbee 장비 목록 반환 */
  getZigbeeDevices(gatewayId: string): ZigbeeDevice[] {
    return this.deviceCache.get(gatewayId) || [];
  }

  onDevicesUpdated(fn: (gatewayId: string) => void): void {
    this.devicesListeners.push(fn);
  }

  removeDevicesListener(fn: (gatewayId: string) => void): void {
    this.devicesListeners = this.devicesListeners.filter(l => l !== fn);
  }
}
