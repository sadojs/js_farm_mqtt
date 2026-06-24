import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Like } from 'typeorm';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/entities/user.entity';
import { Device } from '../devices/entities/device.entity';
import { SensorData } from '../sensors/entities/sensor-data.entity';
import { WeatherData } from '../weather/weather-data.entity';

interface PositionEntry {
  code: string;
  level1: string;
  level2: string;
  level3: string;
  nx: number;
  ny: number;
  longitude: number;
  latitude: number;
  updatedAt: string;
}

interface KmaItem {
  category: string;
  obsrValue: string;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly positions: PositionEntry[];

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Device)
    private readonly devicesRepo: Repository<Device>,
    @InjectRepository(WeatherData)
    private readonly weatherRepo: Repository<WeatherData>,
    private readonly dataSource: DataSource,
  ) {
    const filePath = path.join(process.cwd(), 'src/modules/dashboard/position.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    this.positions = JSON.parse(raw) as PositionEntry[];
  }

  async getWeatherForUser(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    if (!user.address) {
      throw new NotFoundException('사용자 주소가 설정되지 않았습니다.');
    }

    const position = this.findBestPosition(user.address);
    if (!position) {
      throw new NotFoundException(`주소에 대응하는 좌표를 찾지 못했습니다: ${user.address}`);
    }

    let serviceKey: string;
    try {
      serviceKey = this.getServiceKey();
    } catch {
      throw new NotFoundException('기상청 API 키가 설정되지 않아 날씨 정보를 불러올 수 없습니다. KMA_SERVICE_KEY 환경변수를 설정해 주세요.');
    }
    const { baseDate, baseTime } = this.getUltraSrtNcstBaseDateTime(new Date());

    const { data } = await axios.get('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst', {
      params: {
        serviceKey,
        pageNo: 1,
        numOfRows: 100,
        dataType: 'JSON',
        base_date: baseDate,
        base_time: baseTime,
        nx: position.nx,
        ny: position.ny,
      },
      timeout: 10000,
    });

    const header = data?.response?.header;
    if (header?.resultCode !== '00') {
      throw new ServiceUnavailableException(`기상청 API 오류: ${header?.resultMsg || 'unknown error'}`);
    }

    const items = (data?.response?.body?.items?.item || []) as KmaItem[];
    const parsed = this.parseNcstItems(items);

    return {
      location: {
        address: user.address,
        level1: position.level1,
        level2: position.level2,
        level3: position.level3,
        nx: position.nx,
        ny: position.ny,
        longitude: position.longitude,
        latitude: position.latitude,
      },
      weather: {
        temperature: parsed.temperature,
        humidity: parsed.humidity,
        precipitation: parsed.precipitation,
        windSpeed: parsed.windSpeed,
        condition: parsed.condition,
      },
      fetchedAt: new Date().toISOString(),
      source: {
        baseDate,
        baseTime,
        endpoint: 'getUltraSrtNcst',
      },
    };
  }

  /**
   * 대시보드용 날씨 조회 — DB 캐시 우선 (KMA 직접 호출 최소화 + 429/타임아웃에도 500 안 남).
   *  1) 최근(90분 이내) 저장된 WeatherData가 있으면 그대로 반환 → KMA 호출 안 함.
   *  2) 없거나 오래됐으면 KMA 실시간 호출 후 그 값 반환 (수집기가 시간별로 별도 저장).
   *  3) 실시간 호출이 429/타임아웃 등으로 실패하면 → 저장된 마지막 값으로 폴백(stale=true).
   *     저장값조차 없으면 503(안내 메시지). 주소 미설정 등 설정성 오류(404)는 그대로 전달.
   */
  async getWeatherCached(userId: string) {
    const FRESH_MS = 90 * 60 * 1000;

    const latest = await this.weatherRepo.findOne({
      where: { userId },
      order: { time: 'DESC' },
    });

    const isFresh =
      !!latest && Date.now() - new Date(latest.time).getTime() <= FRESH_MS;

    if (isFresh) {
      return this.buildResponseFromStored(userId, latest!, false);
    }

    try {
      return await this.getWeatherForUser(userId);
    } catch (err) {
      // 주소 미설정/좌표 없음/키 미설정 등은 일시 오류가 아니므로 그대로 안내
      if (err instanceof NotFoundException) throw err;

      if (latest) {
        this.logger.warn(
          `날씨 실시간 조회 실패 → 저장값으로 폴백 [${userId}]: ${err?.message ?? err}`,
        );
        return this.buildResponseFromStored(userId, latest, true);
      }
      this.logger.warn(
        `날씨 조회 실패, 캐시 없음 [${userId}]: ${err?.message ?? err}`,
      );
      throw new ServiceUnavailableException(
        '날씨 정보를 일시적으로 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  /** 저장된 WeatherData 한 행을 대시보드 응답 형태로 변환 */
  private async buildResponseFromStored(
    userId: string,
    row: WeatherData,
    stale: boolean,
  ) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    const address = user?.address ?? '';
    const position = address ? this.findBestPosition(address) : null;

    return {
      location: {
        address,
        level1: position?.level1 ?? '',
        level2: position?.level2 ?? '',
        level3: position?.level3 ?? '',
        nx: row.nx ?? position?.nx ?? 0,
        ny: row.ny ?? position?.ny ?? 0,
        longitude: position?.longitude ?? 0,
        latitude: position?.latitude ?? 0,
      },
      weather: {
        temperature: row.temperature != null ? Number(row.temperature) : null,
        humidity: row.humidity != null ? Number(row.humidity) : null,
        precipitation:
          row.precipitation != null ? Number(row.precipitation) : null,
        windSpeed: row.windSpeed != null ? Number(row.windSpeed) : null,
        condition: row.condition ?? 'clear',
      },
      fetchedAt: new Date(row.time).toISOString(),
      stale,
      source: {
        baseDate: '',
        baseTime: '',
        endpoint: 'weather_data(cache)',
      },
    };
  }

  async getWidgetData(userId: string) {
    // 1) qxj 디바이스 찾기
    const qxjDevices = await this.devicesRepo.find({
      where: { userId, category: Like('%qxj%') },
    });
    const qxjIds = qxjDevices.map(d => d.id);

    if (qxjIds.length === 0) {
      this.logger.warn(`qxj 센서 없음 (userId: ${userId})`);
      return { inside: null, history: null, trend6h: null, uvStats14d: null, currentStage: null };
    }

    // 2~6) 병렬 실행 (활성 배치 currentStage 포함)
    const [inside, history, trend6h, uvStats14d] = await Promise.all([
      this.getLatestSensorValues(qxjIds),
      this.getHistoryValues(qxjIds),
      this.getTrend6h(qxjIds),
      this.getUvStats14d(qxjIds),
    ]);

    return {
      inside, history, trend6h, uvStats14d,
      currentStage: null,
    };
  }

  private async getLatestSensorValues(deviceIds: string[]) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (sensor_type) sensor_type, value, time
       FROM sensor_data
       WHERE device_id = ANY($1)
         AND sensor_type IN ('temperature', 'humidity', 'dew_point', 'uv', 'rainfall')
       ORDER BY sensor_type, time DESC`,
      [deviceIds],
    );
    const map = new Map(rows.map((r: any) => [r.sensor_type, Number(r.value)]));
    return {
      temperature: map.get('temperature') ?? null,
      humidity: map.get('humidity') ?? null,
      dewPoint: map.get('dew_point') ?? null,
      uv: map.get('uv') ?? null,
      rainfall: map.get('rainfall') ?? null,
    };
  }

  private async getHistoryValues(deviceIds: string[]) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (sensor_type) sensor_type, value, time
       FROM sensor_data
       WHERE device_id = ANY($1)
         AND sensor_type IN ('temperature', 'humidity')
         AND time BETWEEN (NOW() - INTERVAL '15 minutes') AND (NOW() - INTERVAL '8 minutes')
       ORDER BY sensor_type, time DESC`,
      [deviceIds],
    );
    if (rows.length === 0) return null;
    const map = new Map<string, { value: number; time: Date }>(
      rows.map((r: any) => [r.sensor_type, { value: Number(r.value), time: r.time }]),
    );
    return {
      temperature: map.get('temperature')?.value ?? null,
      humidity: map.get('humidity')?.value ?? null,
      timestamp: (map.get('temperature')?.time || map.get('humidity')?.time || null)?.toISOString?.() ?? null,
    };
  }

  private async getTrend6h(deviceIds: string[]) {
    const rows = await this.dataSource.query(
      `SELECT sensor_type, value, time
       FROM sensor_data
       WHERE device_id = ANY($1)
         AND sensor_type IN ('temperature', 'humidity', 'uv')
         AND time >= NOW() - INTERVAL '6 hours'
       ORDER BY time ASC`,
      [deviceIds],
    );
    const result: Record<string, { time: string; value: number }[]> = {
      temperature: [],
      humidity: [],
      uv: [],
    };
    for (const row of rows) {
      const key = row.sensor_type as string;
      if (result[key]) {
        result[key].push({ time: row.time, value: Number(row.value) });
      }
    }
    return result;
  }

  private async getUvStats14d(deviceIds: string[]) {
    const rows = await this.dataSource.query(
      `SELECT MIN(value) as min, MAX(value) as max
       FROM sensor_data
       WHERE device_id = ANY($1)
         AND sensor_type = 'uv'
         AND time >= NOW() - INTERVAL '14 days'
         AND value > 0`,
      [deviceIds],
    );
    if (!rows[0] || rows[0].min == null) return null;
    return { min: Number(rows[0].min), max: Number(rows[0].max) };
  }

  private getServiceKey(): string {
    const configured = process.env.KMA_SERVICE_KEY || process.env.KMA_API_KEY;
    if (!configured) {
      throw new Error('KMA_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
    }
    // API 키가 URL 인코딩된 형태로 주어지는 경우 디코드
    try {
      return configured.includes('%') ? decodeURIComponent(configured) : configured;
    } catch {
      return configured;
    }
  }

  private findBestPosition(address: string): PositionEntry | null {
    const normalizedAddress = this.normalize(address);

    let best: PositionEntry | null = null;
    let bestScore = -1;

    for (const entry of this.positions) {
      const l1 = this.normalize(entry.level1);
      const l2 = this.normalize(entry.level2);
      const l3 = this.normalize(entry.level3);

      let score = 0;
      if (l1 && normalizedAddress.includes(l1)) score += 10;
      if (l2 && normalizedAddress.includes(l2)) score += 30;
      if (l3 && normalizedAddress.includes(l3)) score += 60;

      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }

    return bestScore > 0 ? best : null;
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '').replace(/[().,-]/g, '');
  }

  private getUltraSrtNcstBaseDateTime(now: Date): { baseDate: string; baseTime: string } {
    const local = new Date(now);

    // 초단기실황은 정시 기준으로 생성되므로 안전하게 45분 이전에는 이전 시각을 사용
    if (local.getMinutes() < 45) {
      local.setHours(local.getHours() - 1);
    }

    const yyyy = local.getFullYear();
    const mm = String(local.getMonth() + 1).padStart(2, '0');
    const dd = String(local.getDate()).padStart(2, '0');
    const hh = String(local.getHours()).padStart(2, '0');

    return {
      baseDate: `${yyyy}${mm}${dd}`,
      baseTime: `${hh}00`,
    };
  }

  private parseNcstItems(items: KmaItem[]) {
    const map = new Map(items.map((item) => [item.category, Number(item.obsrValue)]));

    const temperature = map.get('T1H') ?? null;
    const humidity = map.get('REH') ?? null;
    const precipitation = map.get('RN1') ?? 0;
    const windSpeed = map.get('WSD') ?? null;

    let condition = 'clear';
    if ((precipitation ?? 0) > 0) {
      condition = 'rain';
    }

    return { temperature, humidity, precipitation, windSpeed, condition };
  }
}
