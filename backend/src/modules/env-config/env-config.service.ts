import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EnvRole } from './entities/env-role.entity';
import { EnvMapping } from './entities/env-mapping.entity';
import { Device } from '../devices/entities/device.entity';
import { WeatherData } from '../weather/weather-data.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';

const SENSOR_TYPE_LABELS: Record<string, string> = {
  temperature: '온도', humidity: '습도', co2: 'CO2',
  rainfall: '강우량', uv: 'UV 지수', dew_point: '이슬점',
  rain_detection: '비 감지', pressure: '기압',
};

const WEATHER_FIELD_LABELS: Record<string, { label: string; unit: string }> = {
  temperature:   { label: '외부 온도',  unit: '°C' },
  humidity:      { label: '외부 습도',  unit: '%' },
  precipitation: { label: '강수량',    unit: 'mm' },
  wind_speed:    { label: '풍속',      unit: 'm/s' },
};

const SENSOR_UNITS: Record<string, string> = {
  temperature: '°C', humidity: '%', co2: 'ppm',
  rainfall: 'mm', uv: '', dew_point: '°C',
  rain_detection: '', pressure: 'hPa',
};

/** Zigbee 모델 → 지원 센서 채널 매핑 (sensor_data 이력이 없어도 노출용) */
const ZIGBEE_MODEL_SENSOR_TYPES: Record<string, string[]> = {
  TS0207: ['rain_detection'],  // Tuya 우적/누수 센서 (water_leak → rain_detection)
};

/** Tuya 장비 카테고리 → 지원하는 센서 타입 매핑 */
const CATEGORY_SENSOR_TYPES: Record<string, string[]> = {
  wsdcg:  ['temperature', 'humidity'],          // 온습도 센서
  co2bj:  ['co2'],                              // CO2 센서
  hjjcy:  ['temperature', 'humidity', 'co2'],   // 복합 환경 센서
  qxj:    ['temperature', 'humidity', 'rainfall', 'uv', 'dew_point'], // 기상 관측 장비
  ldcg:   ['illuminance'],                      // 조도 센서
  pm25:   ['pm25'],                             // 미세먼지 센서
  ywbj:   ['smoke'],                            // 연기 감지기
  mcs:    ['door_window'],                      // 문/창문 센서
  cz:     ['power'],                            // 플러그/소켓
};

@Injectable()
export class EnvConfigService {
  constructor(
    @InjectRepository(EnvRole) private roleRepo: Repository<EnvRole>,
    @InjectRepository(EnvMapping) private mappingRepo: Repository<EnvMapping>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    @InjectRepository(WeatherData) private weatherRepo: Repository<WeatherData>,
    @InjectRepository(HouseGroup) private groupRepo: Repository<HouseGroup>,
    private dataSource: DataSource,
  ) {}

  async getRoles(): Promise<EnvRole[]> {
    return this.roleRepo.find({ order: { sortOrder: 'ASC' } });
  }

  async getSources(userId: string | null, groupId: string) {
    const where = userId ? { id: groupId, userId } : { id: groupId };
    const group = await this.groupRepo.findOne({ where, relations: ['devices', 'houses'] });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    // group_devices 매핑 + 게이트웨이→하우스→그룹 경로의 모든 device 합산
    // (구역관리 페이지와 동일한 로직)
    const sensorDevices: Device[] = group.devices.filter(d => d.deviceType === 'sensor');
    const houseIds = (group.houses || []).map(h => h.id);
    if (houseIds.length > 0) {
      // 동일 그룹 내 모든 게이트웨이의 sensor 장치 추가
      // (devices.gateway_id 는 varchar, gateways.id 는 uuid → cast 필요)
      const extra = await this.dataSource.query(`
        SELECT DISTINCT d.* FROM devices d
        JOIN gateways g ON g.id::text = d.gateway_id
        WHERE g.house_id = ANY($1::uuid[])
          AND d.device_type = 'sensor'
      `, [houseIds]);
      const existingIds = new Set(sensorDevices.map(d => d.id));
      for (const d of extra) {
        if (!existingIds.has(d.id)) {
          // raw query 결과 → entity 형태 매핑
          sensorDevices.push({
            id: d.id, userId: d.user_id, houseId: d.house_id, gatewayId: d.gateway_id,
            name: d.name, category: d.category, deviceType: d.device_type,
            equipmentType: d.equipment_type, source: d.source,
            zigbeeModel: d.zigbee_model,
          } as any);
          existingIds.add(d.id);
        }
      }
    }
    const deviceIds = sensorDevices.map(d => d.id);



    let sensorSources: Array<{
      deviceId: string; deviceName: string;
      sensorType: string; label: string;
      currentValue: number | null; unit: string;
    }> = [];

    // sensor_data에서 실측 데이터가 있는 센서 타입 조회
    const dataMap = new Map<string, { value: number; sensorType: string }>();
    if (deviceIds.length > 0) {
      const rows = await this.dataSource.query(`
        SELECT DISTINCT ON (device_id, sensor_type)
          device_id, sensor_type, value, time
        FROM sensor_data
        WHERE device_id = ANY($1)
        ORDER BY device_id, sensor_type, time DESC
      `, [deviceIds]);

      for (const r of rows) {
        dataMap.set(`${r.device_id}:${r.sensor_type}`, {
          value: Number(r.value),
          sensorType: r.sensor_type,
        });
      }
    }

    // 장비 카테고리 기반으로 센서 소스 목록 구성 (데이터 없어도 표시)
    for (const device of sensorDevices) {
      // 실측 데이터가 있는 센서 타입 수집
      const reportedTypes = new Set<string>();
      for (const [key, val] of dataMap) {
        if (key.startsWith(`${device.id}:`)) {
          reportedTypes.add(val.sensorType);
        }
      }

      // 카테고리 매핑에서 예상 센서 타입 가져오기
      const expectedTypes = CATEGORY_SENSOR_TYPES[device.category] || [];

      // Zigbee 모델 기반 예상 타입 (TS0207 우적센서 등 — sensor_data 이력이 없어도 매핑 가능)
      const modelTypes = ZIGBEE_MODEL_SENSOR_TYPES[(device as any).zigbeeModel] || [];

      // 실측 + 예상 + 모델 타입 합산 (중복 제거)
      const allTypes = new Set([...reportedTypes, ...expectedTypes, ...modelTypes]);

      // 매핑이 없고 실측도 없으면 카테고리 자체를 센서 타입으로 표시
      if (allTypes.size === 0) {
        allTypes.add(device.category);
      }

      for (const sensorType of allTypes) {
        const data = dataMap.get(`${device.id}:${sensorType}`);
        sensorSources.push({
          deviceId: device.id,
          deviceName: device.name,
          sensorType,
          label: SENSOR_TYPE_LABELS[sensorType] || sensorType,
          currentValue: data?.value ?? null,
          unit: SENSOR_UNITS[sensorType] || '',
        });
      }
    }

    const weatherRow = userId ? await this.weatherRepo.findOne({
      where: { userId },
      order: { time: 'DESC' },
    }) : null;

    const weatherSources = Object.entries(WEATHER_FIELD_LABELS).map(([field, meta]) => {
      const camelField = field === 'wind_speed' ? 'windSpeed' : field;
      return {
        field,
        label: `기상청 날씨 - ${meta.label}`,
        currentValue: weatherRow ? Number((weatherRow as any)[camelField]) : null,
        unit: meta.unit,
      };
    });

    return { sensors: sensorSources, weather: weatherSources };
  }

  async getMappings(userId: string | null, groupId: string): Promise<EnvMapping[]> {
    const where = userId ? { id: groupId, userId } : { id: groupId };
    const group = await this.groupRepo.findOne({ where });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    return this.mappingRepo.find({
      where: { groupId },
      order: { roleKey: 'ASC' },
    });
  }

  async saveMappings(
    userId: string | null,
    groupId: string,
    mappings: Array<{
      roleKey: string;
      sourceType: 'sensor' | 'weather';
      deviceId?: string;
      sensorType?: string;
      weatherField?: string;
    }>,
  ): Promise<EnvMapping[]> {
    const where2 = userId ? { id: groupId, userId } : { id: groupId };
    const group = await this.groupRepo.findOne({ where: where2 });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    await this.mappingRepo.delete({ groupId });

    const entities = mappings.map(m =>
      this.mappingRepo.create({
        groupId,
        roleKey: m.roleKey,
        sourceType: m.sourceType,
        deviceId: m.sourceType === 'sensor' ? (m.deviceId || null) : null,
        sensorType: m.sourceType === 'sensor' ? (m.sensorType || null) : null,
        weatherField: m.sourceType === 'weather' ? (m.weatherField || null) : null,
      }),
    );

    return this.mappingRepo.save(entities);
  }

  async getResolved(userId: string | null, groupId: string) {
    const where = userId ? { id: groupId, userId } : { id: groupId };
    const group = await this.groupRepo.findOne({ where });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    const mappings = await this.mappingRepo.find({ where: { groupId } });
    const roles = await this.roleRepo.find({ order: { sortOrder: 'ASC' } });

    const sensorMappings = mappings.filter(m => m.sourceType === 'sensor' && m.deviceId);
    const sensorDeviceIds = [...new Set(sensorMappings.map(m => m.deviceId!))];

    const sensorValues = new Map<string, number>();
    const sensorTimes = new Map<string, string>();

    if (sensorDeviceIds.length > 0) {
      const rows = await this.dataSource.query(`
        SELECT DISTINCT ON (device_id, sensor_type)
          device_id, sensor_type, value, time
        FROM sensor_data
        WHERE device_id = ANY($1)
        ORDER BY device_id, sensor_type, time DESC
      `, [sensorDeviceIds]);

      for (const r of rows) {
        const key = `${r.device_id}:${r.sensor_type}`;
        sensorValues.set(key, Number(r.value));
        sensorTimes.set(key, r.time);
      }
    }

    const effectiveUserId = userId ?? group.userId;
    const weatherRow = await this.weatherRepo.findOne({
      where: { userId: effectiveUserId },
      order: { time: 'DESC' },
    });

    const deviceNames = new Map<string, string>();
    if (sensorDeviceIds.length > 0) {
      const devices = await this.deviceRepo.findBy(
        sensorDeviceIds.map(id => ({ id })),
      );
      for (const d of devices) deviceNames.set(d.id, d.name);
    }

    const result: Record<string, {
      value: number | null;
      unit: string;
      label: string;
      category: string;
      source: string;
      updatedAt: string | null;
    }> = {};

    for (const role of roles) {
      const mapping = mappings.find(m => m.roleKey === role.roleKey);

      if (!mapping) {
        result[role.roleKey] = {
          value: null, unit: role.unit, label: role.label,
          category: role.category, source: '미설정', updatedAt: null,
        };
        continue;
      }

      if (mapping.sourceType === 'sensor' && mapping.deviceId && mapping.sensorType) {
        const key = `${mapping.deviceId}:${mapping.sensorType}`;
        const devName = deviceNames.get(mapping.deviceId) || mapping.deviceId;
        result[role.roleKey] = {
          value: sensorValues.get(key) ?? null,
          unit: role.unit,
          label: role.label,
          category: role.category,
          source: `${devName} / ${mapping.sensorType}`,
          updatedAt: sensorTimes.get(key) || null,
        };
      } else if (mapping.sourceType === 'weather' && mapping.weatherField) {
        const field = mapping.weatherField;
        const camelField = field === 'wind_speed' ? 'windSpeed' : field;
        result[role.roleKey] = {
          value: weatherRow ? Number((weatherRow as any)[camelField]) : null,
          unit: role.unit,
          label: role.label,
          category: role.category,
          source: '기상청 날씨',
          updatedAt: weatherRow ? String(weatherRow.time) : null,
        };
      }
    }

    return result;
  }
}
