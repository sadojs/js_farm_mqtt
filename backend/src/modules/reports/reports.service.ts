import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface ReportParams {
  groupId?: string;
  sensorType?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ReportsService {
  constructor(private dataSource: DataSource) {}

  private buildConditions(userId: string, params: ReportParams) {
    const conditions: string[] = ['sd.user_id = $1'];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (params.sensorType) {
      conditions.push(`sd.sensor_type = $${paramIndex++}`);
      values.push(params.sensorType);
    }
    if (params.startDate) {
      conditions.push(`sd.time >= $${paramIndex++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`sd.time <= $${paramIndex++}`);
      values.push(params.endDate);
    }
    if (params.groupId) {
      conditions.push(`gd.group_id = $${paramIndex++}`);
      values.push(params.groupId);
    }
    return { conditions, values, paramIndex };
  }

  private groupJoin(params: ReportParams): string {
    if (params.groupId) {
      return 'JOIN group_devices gd ON gd.device_id = sd.device_id';
    }
    return 'LEFT JOIN group_devices gd ON gd.device_id = sd.device_id';
  }

  async getStatistics(userId: string, params: ReportParams) {
    const { conditions, values } = this.buildConditions(userId, params);
    const whereClause = conditions.join(' AND ');
    const join = this.groupJoin(params);

    const query = `
      SELECT
        sd.sensor_type,
        COUNT(*) as count,
        ROUND(AVG(sd.value)::numeric, 2) as avg_value,
        ROUND(MIN(sd.value)::numeric, 2) as min_value,
        ROUND(MAX(sd.value)::numeric, 2) as max_value,
        sd.unit
      FROM sensor_data sd
      ${join}
      WHERE ${whereClause}
      GROUP BY sd.sensor_type, sd.unit
      ORDER BY sd.sensor_type
    `;

    return this.dataSource.query(query, values);
  }

  async getHourlyData(userId: string, params: ReportParams) {
    const { conditions, values } = this.buildConditions(userId, params);
    const whereClause = conditions.join(' AND ');
    const join = this.groupJoin(params);

    const query = `
      SELECT
        date_trunc('hour', sd.time) as time,
        sd.sensor_type,
        ROUND(AVG(sd.value)::numeric, 2) as avg_value,
        ROUND(MIN(sd.value)::numeric, 2) as min_value,
        ROUND(MAX(sd.value)::numeric, 2) as max_value,
        COUNT(*) as count
      FROM sensor_data sd
      ${join}
      WHERE ${whereClause}
      GROUP BY date_trunc('hour', sd.time), sd.sensor_type
      ORDER BY time ASC
      LIMIT 2000
    `;

    return this.dataSource.query(query, values);
  }

  async getActuatorStats(userId: string, params: ReportParams) {
    const conditions: string[] = ['al.user_id = $1', 'al.success = true'];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (params.startDate) {
      conditions.push(`al.executed_at >= $${paramIndex++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`al.executed_at <= $${paramIndex++}`);
      values.push(params.endDate);
    }
    if (params.groupId) {
      conditions.push(`ar.group_id = $${paramIndex++}`);
      values.push(params.groupId);
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT
        date_trunc('hour', al.executed_at) as time,
        COUNT(*) as total_actions
      FROM automation_logs al
      LEFT JOIN automation_rules ar ON ar.id = al.rule_id
      WHERE ${whereClause}
      GROUP BY date_trunc('hour', al.executed_at)
      ORDER BY time ASC
    `;

    return this.dataSource.query(query, values);
  }

  async exportCsv(userId: string, params: ReportParams): Promise<string> {
    const { conditions, values } = this.buildConditions(userId, params);
    const whereClause = conditions.join(' AND ');
    const join = this.groupJoin(params);

    const query = `
      SELECT
        sd.time,
        d.name as device_name,
        sd.sensor_type,
        sd.value,
        sd.unit,
        sd.status
      FROM sensor_data sd
      JOIN devices d ON d.id = sd.device_id
      ${join}
      WHERE ${whereClause}
      ORDER BY sd.time ASC
      LIMIT 10000
    `;

    const rows = await this.dataSource.query(query, values);

    const header = '시간,장비명,센서종류,값,단위,상태';
    const csvRows = rows.map((row: any) =>
      [
        row.time,
        row.device_name,
        row.sensor_type,
        row.value,
        row.unit,
        row.status,
      ].join(','),
    );

    return [header, ...csvRows].join('\n');
  }

  async getWeatherHourly(userId: string, params: ReportParams) {
    const conditions: string[] = ['wd.user_id = $1'];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (params.startDate) {
      conditions.push(`wd.time >= $${paramIndex++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`wd.time <= $${paramIndex++}`);
      values.push(params.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT
        date_trunc('hour', wd.time) as time,
        ROUND(AVG(wd.temperature)::numeric, 2) as temperature,
        ROUND(AVG(wd.humidity)::numeric, 2) as humidity,
        ROUND(AVG(wd.precipitation)::numeric, 2) as precipitation,
        ROUND(AVG(wd.wind_speed)::numeric, 2) as wind_speed
      FROM weather_data wd
      WHERE ${whereClause}
      GROUP BY date_trunc('hour', wd.time)
      ORDER BY time ASC
      LIMIT 2000
    `;

    return this.dataSource.query(query, values);
  }
}
