# Design: sensor-env-config

> 그룹별 센서 매핑 환경설정 — 상세 설계

## 1. DB 스키마

### 1-1. env_roles 테이블 (환경 역할 정의)

```sql
CREATE TABLE env_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'internal',
  unit VARCHAR(20) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 시드 데이터 (7개 기본 역할)
INSERT INTO env_roles (role_key, label, category, unit, sort_order) VALUES
  ('internal_temp',     '내부 온도',  'internal', '°C',  1),
  ('internal_humidity', '내부 습도',  'internal', '%',   2),
  ('external_temp',     '외부 온도',  'external', '°C',  3),
  ('external_humidity', '외부 습도',  'external', '%',   4),
  ('co2',               'CO2',       'internal', 'ppm', 5),
  ('uv',                'UV',        'external', '',    6),
  ('rainfall',          '강우량',    'external', 'mm',  7);
```

### 1-2. env_mappings 테이블 (그룹별 매핑)

```sql
CREATE TABLE env_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES house_groups(id) ON DELETE CASCADE,
  role_key VARCHAR(50) NOT NULL REFERENCES env_roles(role_key) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('sensor', 'weather')),
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  sensor_type VARCHAR(50),
  weather_field VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, role_key)
);

CREATE INDEX idx_env_mappings_group ON env_mappings(group_id);
```

### 1-3. 홍길동(test@farm.com) 기본 매핑 시드

```sql
-- 석문리 하우스 기본 매핑 (co2는 미설정)
INSERT INTO env_mappings (group_id, role_key, source_type, device_id, sensor_type, weather_field) VALUES
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'internal_temp',     'sensor',  '986948e2-2b53-4f35-ab43-598ccd949ddf', 'temperature', NULL),
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'internal_humidity', 'sensor',  '986948e2-2b53-4f35-ab43-598ccd949ddf', 'humidity',    NULL),
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'external_temp',     'weather', NULL,                                    NULL,          'temperature'),
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'external_humidity', 'weather', NULL,                                    NULL,          'humidity'),
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'uv',               'sensor',  '986948e2-2b53-4f35-ab43-598ccd949ddf', 'uv',          NULL),
  ('6eb2736f-e55b-417a-a2fd-1c5f9c42c46d', 'rainfall',          'sensor',  '986948e2-2b53-4f35-ab43-598ccd949ddf', 'rainfall',    NULL);
```

---

## 2. 백엔드 설계

### 2-1. Entity: EnvRole

**파일**: `backend/src/modules/env-config/entities/env-role.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('env_roles')
export class EnvRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_key', unique: true })
  roleKey: string;

  @Column()
  label: string;

  @Column({ default: 'internal' })
  category: string;

  @Column({ default: '' })
  unit: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_default', default: true })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### 2-2. Entity: EnvMapping

**파일**: `backend/src/modules/env-config/entities/env-mapping.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('env_mappings')
export class EnvMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId: string;

  @Column({ name: 'role_key' })
  roleKey: string;

  @Column({ name: 'source_type' })
  sourceType: 'sensor' | 'weather';

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'sensor_type', nullable: true })
  sensorType: string | null;

  @Column({ name: 'weather_field', nullable: true })
  weatherField: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### 2-3. EnvConfigModule

**파일**: `backend/src/modules/env-config/env-config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvRole } from './entities/env-role.entity';
import { EnvMapping } from './entities/env-mapping.entity';
import { EnvConfigController } from './env-config.controller';
import { EnvConfigService } from './env-config.service';
import { Device } from '../devices/entities/device.entity';
import { WeatherData } from '../weather/weather-data.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EnvRole, EnvMapping, Device, WeatherData, HouseGroup])],
  controllers: [EnvConfigController],
  providers: [EnvConfigService],
  exports: [EnvConfigService],
})
export class EnvConfigModule {}
```

### 2-4. EnvConfigController

**파일**: `backend/src/modules/env-config/env-config.controller.ts`

```typescript
import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { EnvConfigService } from './env-config.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('env-config')
@UseGuards(JwtAuthGuard)
export class EnvConfigController {
  constructor(private envConfigService: EnvConfigService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  // 1) 전체 역할 목록
  @Get('roles')
  getRoles() {
    return this.envConfigService.getRoles();
  }

  // 2) 그룹에 매핑 가능한 소스 목록 (센서 + 날씨)
  @Get('groups/:groupId/sources')
  getSources(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getSources(this.getEffectiveUserId(user), groupId);
  }

  // 3) 그룹 매핑 조회
  @Get('groups/:groupId/mappings')
  getMappings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getMappings(this.getEffectiveUserId(user), groupId);
  }

  // 4) 그룹 매핑 일괄 저장
  @Put('groups/:groupId/mappings')
  saveMappings(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
    @Body() body: { mappings: Array<{
      roleKey: string;
      sourceType: 'sensor' | 'weather';
      deviceId?: string;
      sensorType?: string;
      weatherField?: string;
    }> },
  ) {
    return this.envConfigService.saveMappings(this.getEffectiveUserId(user), groupId, body.mappings);
  }

  // 5) 매핑 기반 현재값 해석
  @Get('groups/:groupId/resolved')
  getResolved(
    @CurrentUser() user: any,
    @Param('groupId') groupId: string,
  ) {
    return this.envConfigService.getResolved(this.getEffectiveUserId(user), groupId);
  }
}
```

### 2-5. EnvConfigService

**파일**: `backend/src/modules/env-config/env-config.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EnvRole } from './entities/env-role.entity';
import { EnvMapping } from './entities/env-mapping.entity';
import { Device } from '../devices/entities/device.entity';
import { WeatherData } from '../weather/weather-data.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';

// 센서 타입 → 한글 라벨
const SENSOR_TYPE_LABELS: Record<string, string> = {
  temperature: '온도', humidity: '습도', co2: 'CO2',
  rainfall: '강우량', uv: 'UV 지수', dew_point: '이슬점',
};

// 날씨 필드 → 한글 라벨 + 단위
const WEATHER_FIELD_LABELS: Record<string, { label: string; unit: string }> = {
  temperature:   { label: '외부 온도',  unit: '°C' },
  humidity:      { label: '외부 습도',  unit: '%' },
  precipitation: { label: '강수량',    unit: 'mm' },
  wind_speed:    { label: '풍속',      unit: 'm/s' },
};

// 센서 타입 → 단위
const SENSOR_UNITS: Record<string, string> = {
  temperature: '°C', humidity: '%', co2: 'ppm',
  rainfall: 'mm', uv: '', dew_point: '°C',
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

  // ── 1) 역할 목록 ──

  async getRoles(): Promise<EnvRole[]> {
    return this.roleRepo.find({ order: { sortOrder: 'ASC' } });
  }

  // ── 2) 매핑 가능한 소스 목록 ──

  async getSources(userId: string, groupId: string) {
    // 그룹 소유권 확인
    const group = await this.groupRepo.findOne({
      where: { id: groupId, userId },
      relations: ['devices'],
    });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    // 2-1) 센서 소스: 그룹에 속한 센서 장비의 최신값
    const deviceIds = group.devices
      .filter(d => d.deviceType === 'sensor')
      .map(d => d.id);

    let sensorSources: Array<{
      deviceId: string; deviceName: string;
      sensorType: string; label: string;
      currentValue: number | null; unit: string;
    }> = [];

    if (deviceIds.length > 0) {
      const rows = await this.dataSource.query(`
        SELECT DISTINCT ON (device_id, sensor_type)
          device_id, sensor_type, value, time
        FROM sensor_data
        WHERE device_id = ANY($1)
        ORDER BY device_id, sensor_type, time DESC
      `, [deviceIds]);

      const deviceMap = new Map(group.devices.map(d => [d.id, d.name]));

      sensorSources = rows.map((r: any) => ({
        deviceId: r.device_id,
        deviceName: deviceMap.get(r.device_id) || r.device_id,
        sensorType: r.sensor_type,
        label: SENSOR_TYPE_LABELS[r.sensor_type] || r.sensor_type,
        currentValue: r.value != null ? Number(r.value) : null,
        unit: SENSOR_UNITS[r.sensor_type] || '',
      }));
    }

    // 2-2) 날씨 소스: 최신 weather_data
    const weatherRow = await this.weatherRepo.findOne({
      where: { userId },
      order: { time: 'DESC' },
    });

    const weatherSources = Object.entries(WEATHER_FIELD_LABELS).map(([field, meta]) => ({
      field,
      label: `기상청 날씨 - ${meta.label}`,
      currentValue: weatherRow ? Number((weatherRow as any)[field === 'wind_speed' ? 'windSpeed' : field]) : null,
      unit: meta.unit,
    }));

    return { sensors: sensorSources, weather: weatherSources };
  }

  // ── 3) 매핑 조회 ──

  async getMappings(userId: string, groupId: string): Promise<EnvMapping[]> {
    // 소유권 확인
    const group = await this.groupRepo.findOne({ where: { id: groupId, userId } });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    return this.mappingRepo.find({
      where: { groupId },
      order: { roleKey: 'ASC' },
    });
  }

  // ── 4) 매핑 일괄 저장 ──

  async saveMappings(
    userId: string,
    groupId: string,
    mappings: Array<{
      roleKey: string;
      sourceType: 'sensor' | 'weather';
      deviceId?: string;
      sensorType?: string;
      weatherField?: string;
    }>,
  ): Promise<EnvMapping[]> {
    // 소유권 확인
    const group = await this.groupRepo.findOne({ where: { id: groupId, userId } });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    // 기존 매핑 삭제 후 새로 삽입 (UPSERT 대신 심플하게)
    await this.mappingRepo.delete({ groupId });

    const entities = mappings.map(m =>
      this.mappingRepo.create({
        groupId,
        roleKey: m.roleKey,
        sourceType: m.sourceType,
        deviceId: m.sourceType === 'sensor' ? m.deviceId : null,
        sensorType: m.sourceType === 'sensor' ? m.sensorType : null,
        weatherField: m.sourceType === 'weather' ? m.weatherField : null,
      }),
    );

    return this.mappingRepo.save(entities);
  }

  // ── 5) 매핑 기반 현재값 해석 ──

  async getResolved(userId: string, groupId: string) {
    // 소유권 확인
    const group = await this.groupRepo.findOne({ where: { id: groupId, userId } });
    if (!group) throw new NotFoundException('그룹을 찾을 수 없습니다.');

    const mappings = await this.mappingRepo.find({ where: { groupId } });
    const roles = await this.roleRepo.find({ order: { sortOrder: 'ASC' } });

    // 센서 매핑의 현재값 일괄 조회
    const sensorMappings = mappings.filter(m => m.sourceType === 'sensor' && m.deviceId);
    const sensorDeviceIds = [...new Set(sensorMappings.map(m => m.deviceId!))];

    let sensorValues = new Map<string, number>();
    let sensorTimes = new Map<string, string>();

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

    // 날씨 매핑의 현재값
    const weatherRow = await this.weatherRepo.findOne({
      where: { userId },
      order: { time: 'DESC' },
    });

    // 장비명 조회
    const deviceNames = new Map<string, string>();
    if (sensorDeviceIds.length > 0) {
      const devices = await this.deviceRepo.findByIds(sensorDeviceIds);
      for (const d of devices) deviceNames.set(d.id, d.name);
    }

    // 역할별 해석 결과
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
          source: `기상청 날씨`,
          updatedAt: weatherRow ? (weatherRow.time as any).toISOString?.() || String(weatherRow.time) : null,
        };
      }
    }

    return result;
  }
}
```

---

## 3. 프론트엔드 설계

### 3-1. API 클라이언트

**파일**: `frontend/src/api/env-config.api.ts`

```typescript
import apiClient from './client'

export interface EnvRole {
  id: string
  roleKey: string
  label: string
  category: 'internal' | 'external'
  unit: string
  sortOrder: number
  isDefault: boolean
}

export interface EnvMapping {
  id: string
  groupId: string
  roleKey: string
  sourceType: 'sensor' | 'weather'
  deviceId: string | null
  sensorType: string | null
  weatherField: string | null
}

export interface SensorSource {
  deviceId: string
  deviceName: string
  sensorType: string
  label: string
  currentValue: number | null
  unit: string
}

export interface WeatherSource {
  field: string
  label: string
  currentValue: number | null
  unit: string
}

export interface SourcesResponse {
  sensors: SensorSource[]
  weather: WeatherSource[]
}

export interface SaveMappingItem {
  roleKey: string
  sourceType: 'sensor' | 'weather'
  deviceId?: string
  sensorType?: string
  weatherField?: string
}

export interface ResolvedValue {
  value: number | null
  unit: string
  label: string
  category: string
  source: string
  updatedAt: string | null
}

export const envConfigApi = {
  getRoles: () =>
    apiClient.get<EnvRole[]>('/env-config/roles'),

  getSources: (groupId: string) =>
    apiClient.get<SourcesResponse>(`/env-config/groups/${groupId}/sources`),

  getMappings: (groupId: string) =>
    apiClient.get<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`),

  saveMappings: (groupId: string, mappings: SaveMappingItem[]) =>
    apiClient.put<EnvMapping[]>(`/env-config/groups/${groupId}/mappings`, { mappings }),

  getResolved: (groupId: string) =>
    apiClient.get<Record<string, ResolvedValue>>(`/env-config/groups/${groupId}/resolved`),
}
```

### 3-2. Groups.vue — 환경설정 버튼 추가

**파일**: `frontend/src/views/Groups.vue`

그룹 헤더 영역 (`group-header-actions`)에 설정 버튼 추가:

```html
<!-- 기존 group-header-actions 내부, device-count-badge 뒤에 추가 -->
<button class="btn-icon" @click="openEnvConfig(group)" aria-label="환경설정">⚙</button>
```

스크립트에 추가:

```typescript
import { envConfigApi } from '../api/env-config.api'
import type { EnvRole, EnvMapping, SourcesResponse, SaveMappingItem } from '../api/env-config.api'

// 환경설정 모달 상태
const showEnvConfigModal = ref(false)
const envConfigGroup = ref<HouseGroup | null>(null)
const envRoles = ref<EnvRole[]>([])
const envSources = ref<SourcesResponse>({ sensors: [], weather: [] })
const envMappings = ref<Record<string, { sourceType: string; deviceId?: string; sensorType?: string; weatherField?: string }>>({})
const envSaving = ref(false)

async function openEnvConfig(group: HouseGroup) {
  envConfigGroup.value = group
  showEnvConfigModal.value = true

  // 병렬 로드: 역할 + 소스 + 기존 매핑
  const [rolesRes, sourcesRes, mappingsRes] = await Promise.all([
    envConfigApi.getRoles(),
    envConfigApi.getSources(group.id),
    envConfigApi.getMappings(group.id),
  ])

  envRoles.value = rolesRes.data
  envSources.value = sourcesRes.data

  // 기존 매핑을 roleKey 기반 맵으로 변환
  const map: Record<string, any> = {}
  for (const m of mappingsRes.data) {
    map[m.roleKey] = {
      sourceType: m.sourceType,
      deviceId: m.deviceId || undefined,
      sensorType: m.sensorType || undefined,
      weatherField: m.weatherField || undefined,
    }
  }
  envMappings.value = map
}

async function saveEnvConfig() {
  if (!envConfigGroup.value) return
  envSaving.value = true
  try {
    const mappings: SaveMappingItem[] = Object.entries(envMappings.value)
      .filter(([_, v]) => v.sourceType) // 미설정 건너뛰기
      .map(([roleKey, v]) => ({
        roleKey,
        sourceType: v.sourceType as 'sensor' | 'weather',
        deviceId: v.deviceId,
        sensorType: v.sensorType,
        weatherField: v.weatherField,
      }))
    await envConfigApi.saveMappings(envConfigGroup.value.id, mappings)
    showEnvConfigModal.value = false
  } catch {
    alert('매핑 저장에 실패했습니다.')
  } finally {
    envSaving.value = false
  }
}

// 드롭다운 선택 시 매핑 업데이트
function onSourceSelect(roleKey: string, value: string) {
  if (!value) {
    // 미설정
    delete envMappings.value[roleKey]
    return
  }
  // value 형식: "sensor:{deviceId}:{sensorType}" 또는 "weather:{field}"
  const parts = value.split(':')
  if (parts[0] === 'sensor') {
    envMappings.value[roleKey] = {
      sourceType: 'sensor',
      deviceId: parts[1],
      sensorType: parts[2],
    }
  } else if (parts[0] === 'weather') {
    envMappings.value[roleKey] = {
      sourceType: 'weather',
      weatherField: parts[1],
    }
  }
}

// 현재 매핑에 대한 드롭다운 선택값 계산
function getSelectedValue(roleKey: string): string {
  const m = envMappings.value[roleKey]
  if (!m) return ''
  if (m.sourceType === 'sensor') return `sensor:${m.deviceId}:${m.sensorType}`
  if (m.sourceType === 'weather') return `weather:${m.weatherField}`
  return ''
}
```

### 3-3. 환경설정 모달 (Groups.vue 내 인라인)

```html
<!-- 환경설정 모달 -->
<div v-if="showEnvConfigModal && envConfigGroup" class="modal-overlay" @click.self="showEnvConfigModal = false">
  <div class="env-config-modal">
    <div class="env-modal-header">
      <h3>센서 환경 설정 — {{ envConfigGroup.name }}</h3>
      <button class="close-btn" @click="showEnvConfigModal = false">✕</button>
    </div>
    <div class="env-modal-body">
      <!-- 내부 환경 -->
      <div class="env-section-label">내부 환경</div>
      <template v-for="role in envRoles.filter(r => r.category === 'internal')" :key="role.roleKey">
        <div class="env-role-row">
          <label class="env-role-label">{{ role.label }} <span v-if="role.unit" class="env-unit">({{ role.unit }})</span></label>
          <select
            class="env-source-select"
            :value="getSelectedValue(role.roleKey)"
            @change="onSourceSelect(role.roleKey, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">(미설정)</option>
            <optgroup label="센서 장비">
              <option
                v-for="s in envSources.sensors"
                :key="`sensor:${s.deviceId}:${s.sensorType}`"
                :value="`sensor:${s.deviceId}:${s.sensorType}`"
              >
                {{ s.deviceName }} - {{ s.label }} ({{ s.sensorType }}) - {{ s.currentValue != null ? s.currentValue : '-' }}{{ s.unit }}
              </option>
            </optgroup>
            <optgroup label="기상청 날씨">
              <option
                v-for="w in envSources.weather"
                :key="`weather:${w.field}`"
                :value="`weather:${w.field}`"
              >
                {{ w.label }} ({{ w.field }}) - {{ w.currentValue != null ? w.currentValue : '-' }}{{ w.unit }}
              </option>
            </optgroup>
          </select>
        </div>
      </template>

      <!-- 외부 환경 -->
      <div class="env-section-label" style="margin-top: 16px;">외부 환경</div>
      <template v-for="role in envRoles.filter(r => r.category === 'external')" :key="role.roleKey">
        <div class="env-role-row">
          <label class="env-role-label">{{ role.label }} <span v-if="role.unit" class="env-unit">({{ role.unit }})</span></label>
          <select
            class="env-source-select"
            :value="getSelectedValue(role.roleKey)"
            @change="onSourceSelect(role.roleKey, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">(미설정)</option>
            <optgroup label="센서 장비">
              <option
                v-for="s in envSources.sensors"
                :key="`sensor:${s.deviceId}:${s.sensorType}`"
                :value="`sensor:${s.deviceId}:${s.sensorType}`"
              >
                {{ s.deviceName }} - {{ s.label }} ({{ s.sensorType }}) - {{ s.currentValue != null ? s.currentValue : '-' }}{{ s.unit }}
              </option>
            </optgroup>
            <optgroup label="기상청 날씨">
              <option
                v-for="w in envSources.weather"
                :key="`weather:${w.field}`"
                :value="`weather:${w.field}`"
              >
                {{ w.label }} ({{ w.field }}) - {{ w.currentValue != null ? w.currentValue : '-' }}{{ w.unit }}
              </option>
            </optgroup>
          </select>
        </div>
      </template>
    </div>
    <div class="env-modal-footer">
      <button class="btn-secondary" @click="showEnvConfigModal = false">취소</button>
      <button class="btn-primary" @click="saveEnvConfig" :disabled="envSaving">
        {{ envSaving ? '저장 중...' : '저장' }}
      </button>
    </div>
  </div>
</div>
```

### 3-4. 환경설정 모달 스타일

```css
.env-config-modal {
  background: var(--bg-card); border-radius: 16px;
  width: 100%; max-width: 600px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-modal);
}
.env-modal-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px; border-bottom: 1px solid var(--border-color);
}
.env-modal-header h3 { font-size: calc(18px * var(--content-scale, 1)); font-weight: 600; margin: 0; }
.env-modal-body {
  flex: 1; overflow-y: auto; padding: 16px 24px;
}
.env-modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  padding: 16px 24px; border-top: 1px solid var(--border-color);
}
.env-section-label {
  font-size: calc(13px * var(--content-scale, 1));
  font-weight: 600; color: var(--text-secondary);
  padding: 8px 0 4px; border-bottom: 1px solid var(--border-light);
  margin-bottom: 8px;
}
.env-role-row {
  margin-bottom: 12px;
}
.env-role-label {
  display: block; font-size: calc(14px * var(--content-scale, 1));
  font-weight: 500; color: var(--text-primary); margin-bottom: 4px;
}
.env-unit { color: var(--text-muted); font-weight: 400; }
.env-source-select {
  width: 100%; padding: 10px 12px;
  background: var(--bg-secondary); color: var(--text-primary);
  border: 1px solid var(--border-input); border-radius: 8px;
  font-size: calc(14px * var(--content-scale, 1));
  cursor: pointer; appearance: auto;
}
.env-source-select:focus {
  outline: none; border-color: var(--accent);
}

@media (max-width: 768px) {
  .env-config-modal {
    border-radius: 0; max-width: 100%;
    max-height: 100%; height: 100vh; height: 100dvh;
  }
}
```

---

## 4. 파일 변경 목록

### 신규 파일 (5개)

| # | 파일 | 설명 |
|---|------|------|
| N1 | `backend/src/modules/env-config/entities/env-role.entity.ts` | 환경 역할 엔티티 |
| N2 | `backend/src/modules/env-config/entities/env-mapping.entity.ts` | 환경 매핑 엔티티 |
| N3 | `backend/src/modules/env-config/env-config.module.ts` | 모듈 |
| N4 | `backend/src/modules/env-config/env-config.controller.ts` | API 5개 엔드포인트 |
| N5 | `backend/src/modules/env-config/env-config.service.ts` | CRUD + 해석 서비스 |
| N6 | `frontend/src/api/env-config.api.ts` | API 클라이언트 |

### 수정 파일 (3개)

| # | 파일 | 변경 |
|---|------|------|
| M1 | `backend/src/app.module.ts` | EnvConfigModule import 추가 |
| M2 | `frontend/src/views/Groups.vue` | 환경설정 버튼 + 모달 + 스타일 추가 |
| M3 | `backend/database/schema.sql` | env_roles + env_mappings DDL 추가 |

### SQL 직접 실행

| # | 작업 |
|---|------|
| S1 | `env_roles` 테이블 생성 + 7개 시드 |
| S2 | `env_mappings` 테이블 생성 |
| S3 | 홍길동 기본 매핑 6개 삽입 |

---

## 5. 구현 순서

### Phase 1: DB 스키마 (S1~S3, M3)

| Step | 작업 |
|------|------|
| 1-1 | `env_roles` 테이블 생성 + 7개 시드 INSERT |
| 1-2 | `env_mappings` 테이블 생성 + 인덱스 |
| 1-3 | 홍길동 기본 매핑 6개 INSERT |
| 1-4 | `schema.sql`에 DDL 추가 |

### Phase 2: 백엔드 (N1~N5, M1)

| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | `env-role.entity.ts` | EnvRole 엔티티 정의 |
| 2-2 | `env-mapping.entity.ts` | EnvMapping 엔티티 정의 |
| 2-3 | `env-config.service.ts` | getRoles, getSources, getMappings, saveMappings, getResolved |
| 2-4 | `env-config.controller.ts` | 5개 엔드포인트 + getEffectiveUserId |
| 2-5 | `env-config.module.ts` | 모듈 등록 |
| 2-6 | `app.module.ts` | EnvConfigModule import |

### Phase 3: 프론트엔드 (N6, M2)

| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | `env-config.api.ts` | 타입 + API 메서드 5개 |
| 3-2 | `Groups.vue` | 환경설정 버튼 추가 |
| 3-3 | `Groups.vue` | 환경설정 모달 + 로직 + 스타일 |

### Phase 4: 빌드 검증

| Step | 작업 |
|------|------|
| 4-1 | `cd backend && npm run build` |
| 4-2 | `cd frontend && npm run build` |

### Phase 5: 전후 비교 검증

| Step | 작업 |
|------|------|
| 5-1 | `GET /env-config/roles` → 7개 역할 |
| 5-2 | `GET /env-config/groups/:id/sources` → 센서 + 날씨 소스 |
| 5-3 | `GET /env-config/groups/:id/mappings` → 기본 매핑 6개 |
| 5-4 | `GET /env-config/groups/:id/resolved` → 매핑 기반 현재값 |
| 5-5 | 해석된 값과 기존 대시보드 값 비교 |

---

## 6. 검증 항목 (Gap Analysis용)

| # | 카테고리 | 검증 항목 |
|---|----------|----------|
| 1 | DB | env_roles 테이블 + 7개 시드 (schema.sql 포함) |
| 2 | DB | env_mappings 테이블 + UNIQUE 제약 + 인덱스 |
| 3 | DB | 홍길동 기본 매핑 6개 (co2 제외) |
| 4 | Backend | EnvRole 엔티티 (7 컬럼) |
| 5 | Backend | EnvMapping 엔티티 (7 컬럼) |
| 6 | Backend | EnvConfigModule (5 엔티티 import) |
| 7 | Backend | GET /env-config/roles |
| 8 | Backend | GET /env-config/groups/:id/sources (센서 + 날씨) |
| 9 | Backend | GET /env-config/groups/:id/mappings |
| 10 | Backend | PUT /env-config/groups/:id/mappings (일괄 저장) |
| 11 | Backend | GET /env-config/groups/:id/resolved (해석) |
| 12 | Backend | getEffectiveUserId 패턴 |
| 13 | Backend | app.module.ts에 EnvConfigModule import |
| 14 | Frontend | env-config.api.ts 타입 + 5개 메서드 |
| 15 | Frontend | Groups.vue 환경설정 버튼 (⚙) |
| 16 | Frontend | 환경설정 모달 (역할별 드롭다운) |
| 17 | Frontend | 드롭다운: 센서 + 날씨 optgroup 분리 |
| 18 | Frontend | 드롭다운 표시 형식: {장비명} - {한글명} ({영문}) - {값}{단위} |
| 19 | Frontend | 매핑 저장 기능 |
| 20 | Frontend | 내부/외부 섹션 구분 UI |
| 21 | Build | 백엔드 + 프론트엔드 빌드 통과 |
