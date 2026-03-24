import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SensorData } from './entities/sensor-data.entity';

@Injectable()
export class SensorsService {
  constructor(
    @InjectRepository(SensorData) private sensorRepo: Repository<SensorData>,
    private dataSource: DataSource,
  ) {}

  async queryData(userId: string, params: {
    sensorType?: string;
    startTime: string;
    endTime: string;
    aggregation?: string;
    deviceId?: string;
    limit?: number;
    offset?: number;
  }) {
    const { sensorType, startTime, endTime, aggregation, deviceId, limit = 500, offset = 0 } = params;

    let query: string;
    const queryParams: any[] = [userId, startTime, endTime];
    let paramIndex = 4;

    if (aggregation === 'hourly') {
      query = `
        SELECT bucket as time, avg_value as value, min_value, max_value, sample_count, sensor_type
        FROM sensor_data_hourly
        WHERE user_id = $1 AND bucket BETWEEN $2 AND $3
      `;
    } else if (aggregation === 'daily') {
      query = `
        SELECT bucket as time, avg_value as value, min_value, max_value, sample_count, sensor_type
        FROM sensor_data_daily
        WHERE user_id = $1 AND bucket BETWEEN $2 AND $3
      `;
    } else {
      query = `
        SELECT time, value, unit, status, sensor_type, device_id
        FROM sensor_data
        WHERE user_id = $1 AND time BETWEEN $2 AND $3
      `;
    }

    if (sensorType) {
      query += ` AND sensor_type = $${paramIndex}`;
      queryParams.push(sensorType);
      paramIndex++;
    }

    if (deviceId) {
      query += ` AND device_id = $${paramIndex}`;
      queryParams.push(deviceId);
      paramIndex++;
    }

    const orderCol = aggregation === 'hourly' || aggregation === 'daily' ? 'bucket' : 'time';
    query += ` ORDER BY ${orderCol} ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    const data = await this.dataSource.query(query, queryParams);

    // 통계 쿼리
    const statsQuery = `
      SELECT
        AVG(value) as avg, MIN(value) as min, MAX(value) as max,
        COUNT(*) as count, STDDEV(value) as stddev
      FROM sensor_data
      WHERE user_id = $1 AND time BETWEEN $2 AND $3
      ${sensorType ? `AND sensor_type = $4` : ''}
    `;
    const statsParams = [userId, startTime, endTime];
    if (sensorType) statsParams.push(sensorType);
    const [stats] = await this.dataSource.query(statsQuery, statsParams);

    return { data, statistics: stats };
  }

  async storeSensorData(data: {
    deviceId: string;
    userId: string;
    sensorType: string;
    value: number;
    unit: string;
    status?: string;
  }) {
    const entity = this.sensorRepo.create({
      time: new Date(),
      deviceId: data.deviceId,
      userId: data.userId,
      sensorType: data.sensorType,
      value: data.value,
      unit: data.unit,
      status: (data.status as any) || 'normal',
    });
    return this.sensorRepo.save(entity);
  }

  async getLatest(userId: string) {
    const query = `
      SELECT DISTINCT ON (device_id, sensor_type)
        device_id, sensor_type, value, unit, status, time
      FROM sensor_data
      WHERE user_id = $1
      ORDER BY device_id, sensor_type, time DESC
    `;
    return this.dataSource.query(query, [userId]);
  }
}
