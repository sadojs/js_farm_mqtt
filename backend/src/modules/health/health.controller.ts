import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MqttService } from '../mqtt/mqtt.service';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: string; latencyMs?: number };
    mqtt: { status: string };
  };
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private mqttService: MqttService,
    private config: ConfigService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      mqtt: this.checkMqtt(),
    };

    const allOk = Object.values(checks).every((c) => c.status === 'ok');
    const anyError = Object.values(checks).some((c) => c.status === 'error');

    return {
      status: allOk ? 'ok' : anyError ? 'error' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }

  @Get('live')
  liveness() {
    return { status: 'ok' };
  }

  private async checkDatabase(): Promise<{ status: string; latencyMs?: number }> {
    try {
      const start = Date.now();
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch {
      return { status: 'error' };
    }
  }

  private checkMqtt(): { status: string } {
    return { status: this.mqttService.isConnected() ? 'ok' : 'error' };
  }
}
