import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gateway } from '../gateway-manager/entities/gateway.entity';
import { MqttService } from '../mqtt/mqtt.service';
import { GpioRelayCommandDto } from './dto/gpio-relay-command.dto';

@Injectable()
export class GpioService {
  constructor(
    @InjectRepository(Gateway) private gatewayRepo: Repository<Gateway>,
    private mqttService: MqttService,
  ) {}

  async sendRelayCommand(gatewayId: string, userId: string, role: string, cmd: GpioRelayCommandDto): Promise<{ success: boolean; message: string }> {
    const gw = role === 'admin'
      ? await this.gatewayRepo.findOne({ where: { id: gatewayId } })
      : await this.gatewayRepo.findOne({ where: { id: gatewayId, userId } });
    if (!gw) throw new NotFoundException('게이트웨이를 찾을 수 없습니다.');

    await this.mqttService.publishGpioRelay(gw.gatewayId, cmd);
    return { success: true, message: `GPIO 명령 발행 완료 (BCM ${cmd.pin} → ${cmd.state ? 'HIGH' : 'LOW'})` };
  }
}
