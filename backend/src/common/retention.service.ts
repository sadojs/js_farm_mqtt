import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly dataSource: DataSource) {}

  // 매일 새벽 3시에 실행
  @Cron('0 3 * * *')
  async cleanupOldData() {
    const policies = [
      { table: 'automation_logs', column: 'executed_at', interval: '1 month' },
      { table: 'activity_logs', column: 'created_at', interval: '3 months' },
      { table: 'sensor_alerts', column: 'created_at', interval: '3 months', extraWhere: 'AND resolved = true' },
      { table: 'notifications', column: 'created_at', interval: '2 months' },
    ];

    for (const p of policies) {
      try {
        const where = `${p.column} < NOW() - INTERVAL '${p.interval}' ${p.extraWhere || ''}`;
        const result = await this.dataSource.query(`DELETE FROM ${p.table} WHERE ${where}`);
        const count = result?.[1] ?? 0;
        if (count > 0) {
          this.logger.log(`${p.table}: ${count}건 삭제 (${p.interval} 이전)`);
        }
      } catch (err: any) {
        this.logger.error(`${p.table} 정리 실패: ${err.message}`);
      }
    }
  }
}
