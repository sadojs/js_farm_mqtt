# Design: harvest-sensor-alerts

> 수확 예측 카운터 + 센서 이상 감지 — 상세 설계

## 1. DB 스키마

### 1-1. crop_batches 테이블

```sql
CREATE TABLE crop_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop_name VARCHAR(100) NOT NULL,
  variety VARCHAR(100),
  house_name VARCHAR(100) NOT NULL,
  sow_date DATE NOT NULL,
  grow_days INT NOT NULL CHECK (grow_days BETWEEN 1 AND 365),
  stage VARCHAR(50) DEFAULT 'seedling',
  memo TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crop_batches_user ON crop_batches(user_id, status);
```

### 1-2. sensor_alerts 테이블

```sql
CREATE TABLE sensor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_name VARCHAR(255),
  sensor_type VARCHAR(50) NOT NULL,
  alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('no_data', 'flatline', 'spike', 'out_of_range')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
  message TEXT NOT NULL,
  value DECIMAL(10, 4),
  threshold TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sensor_alerts_user ON sensor_alerts(user_id, resolved, created_at DESC);
CREATE INDEX idx_sensor_alerts_device ON sensor_alerts(device_id, alert_type, resolved);
```

---

## 2. 백엔드 설계 — 수확 예측

### 2-1. Entity: CropBatch

**파일**: `backend/src/modules/harvest/entities/crop-batch.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('crop_batches')
export class CropBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'crop_name' })
  cropName: string;

  @Column({ nullable: true })
  variety: string;

  @Column({ name: 'house_name' })
  houseName: string;

  @Column({ name: 'sow_date', type: 'date' })
  sowDate: string; // YYYY-MM-DD

  @Column({ name: 'grow_days', type: 'int' })
  growDays: number;

  @Column({ default: 'seedling' })
  stage: string;

  @Column({ type: 'text', nullable: true })
  memo: string;

  @Column({ default: 'active' })
  status: 'active' | 'completed';

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### 2-2. DTO: CreateBatchDto

**파일**: `backend/src/modules/harvest/dto/create-batch.dto.ts`

```typescript
import { IsString, IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';

export class CreateBatchDto {
  @IsString()
  cropName: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsString()
  houseName: string;

  @IsDateString()
  sowDate: string;

  @IsInt()
  @Min(1)
  @Max(365)
  growDays: number;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  cropName?: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsOptional()
  @IsString()
  houseName?: string;

  @IsOptional()
  @IsDateString()
  sowDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  growDays?: number;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}
```

### 2-3. HarvestModule

**파일**: `backend/src/modules/harvest/harvest.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([CropBatch])],
  controllers: [HarvestController],
  providers: [HarvestService],
})
export class HarvestModule {}
```

### 2-4. HarvestController

**파일**: `backend/src/modules/harvest/harvest.controller.ts`

```typescript
@Controller('harvest')
@UseGuards(JwtAuthGuard)
export class HarvestController {
  constructor(private harvestService: HarvestService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get('batches')
  findAll(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.harvestService.findAll(this.getEffectiveUserId(user), status);
  }

  @Get('batches/:id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.findOne(this.getEffectiveUserId(user), id);
  }

  @Post('batches')
  create(@CurrentUser() user: any, @Body() dto: CreateBatchDto) {
    return this.harvestService.create(this.getEffectiveUserId(user), dto);
  }

  @Put('batches/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateBatchDto) {
    return this.harvestService.update(this.getEffectiveUserId(user), id, dto);
  }

  @Put('batches/:id/complete')
  complete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.complete(this.getEffectiveUserId(user), id);
  }

  @Post('batches/:id/clone')
  clone(@CurrentUser() user: any, @Param('id') id: string, @Body('houseName') houseName: string) {
    return this.harvestService.clone(this.getEffectiveUserId(user), id, houseName);
  }

  @Delete('batches/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.harvestService.remove(this.getEffectiveUserId(user), id);
  }
}
```

### 2-5. HarvestService

**파일**: `backend/src/modules/harvest/harvest.service.ts`

```typescript
@Injectable()
export class HarvestService {
  constructor(
    @InjectRepository(CropBatch) private batchRepo: Repository<CropBatch>,
  ) {}

  async findAll(userId: string, status?: string) {
    const where: any = { userId };
    if (status === 'active' || status === 'completed') where.status = status;
    return this.batchRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(userId: string, id: string) {
    return this.batchRepo.findOneOrFail({ where: { id, userId } });
  }

  async create(userId: string, dto: CreateBatchDto) {
    const batch = this.batchRepo.create({ ...dto, userId });
    return this.batchRepo.save(batch);
  }

  async update(userId: string, id: string, dto: UpdateBatchDto) {
    await this.batchRepo.update({ id, userId }, dto);
    return this.findOne(userId, id);
  }

  async complete(userId: string, id: string) {
    await this.batchRepo.update({ id, userId }, {
      status: 'completed',
      completedAt: new Date(),
    });
    return this.findOne(userId, id);
  }

  async clone(userId: string, id: string, houseName: string) {
    const original = await this.findOne(userId, id);
    const { id: _, createdAt, updatedAt, completedAt, status, ...data } = original;
    return this.batchRepo.save(this.batchRepo.create({
      ...data,
      houseName: houseName || data.houseName,
      status: 'active',
      completedAt: null,
    }));
  }

  async remove(userId: string, id: string) {
    await this.batchRepo.delete({ id, userId });
    return { deleted: true };
  }
}
```

---

## 3. 백엔드 설계 — 센서 이상 감지

### 3-1. Entity: SensorAlert

**파일**: `backend/src/modules/sensor-alerts/entities/sensor-alert.entity.ts`

```typescript
@Entity('sensor_alerts')
export class SensorAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'device_name', nullable: true })
  deviceName: string;

  @Column({ name: 'sensor_type' })
  sensorType: string;

  @Column({ name: 'alert_type' })
  alertType: 'no_data' | 'flatline' | 'spike' | 'out_of_range';

  @Column()
  severity: 'warning' | 'critical';

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  value: number;

  @Column({ type: 'text', nullable: true })
  threshold: string;

  @Column({ default: false })
  resolved: boolean;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'snoozed_until', type: 'timestamptz', nullable: true })
  snoozedUntil: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### 3-2. 감지 룰 상수

**파일**: `backend/src/modules/sensor-alerts/sensor-alert-rules.ts`

```typescript
// 강원도 횡성군 둔내 기준 + 방울토마토 하우스 재배
export interface AlertRuleParams {
  epsilon: number;       // flatline 변화 감지 임계값
  spikeThreshold: number; // spike 10분 변화 임계값
  min: number;           // 물리적 최소값
  max: number;           // 물리적 최대값
  unit: string;
}

export const SENSOR_ALERT_RULES: Record<string, AlertRuleParams> = {
  temperature:   { epsilon: 0.3,  spikeThreshold: 8,   min: -15, max: 55,   unit: '°C' },
  humidity:      { epsilon: 0.5,  spikeThreshold: 25,  min: 0,   max: 100,  unit: '%' },
  co2:           { epsilon: 10,   spikeThreshold: 500, min: 250, max: 5000, unit: 'ppm' },
  soil_moisture: { epsilon: 0.5,  spikeThreshold: 20,  min: 0,   max: 100,  unit: '%' },
  uv:            { epsilon: 0.5,  spikeThreshold: 5,   min: 0,   max: 15,   unit: 'idx' },
  dew_point:     { epsilon: 0.3,  spikeThreshold: 5,   min: -20, max: 40,   unit: '°C' },
  rainfall:      { epsilon: 0.1,  spikeThreshold: 50,  min: 0,   max: 300,  unit: 'mm' },
};

// 데이터 없음 임계값 (분)
export const NO_DATA_WARNING_MINUTES = 30;
export const NO_DATA_CRITICAL_MINUTES = 360; // 6시간

// Flatline 윈도우 (시간)
export const FLATLINE_WINDOW_HOURS = 24;

// 유형별 조치 가이드
export const ACTION_GUIDES: Record<string, string[]> = {
  no_data: [
    '배터리/전원 상태를 확인하세요',
    '게이트웨이 연결 상태를 확인하세요',
    'Tuya 앱에서 장비 온라인 상태를 확인하세요',
  ],
  flatline: [
    '센서 프로브의 접촉 상태를 확인하세요',
    '센서 전원을 리부팅하세요',
    '주변 다른 센서 값과 비교해보세요',
  ],
  spike: [
    '주변 환경에 급격한 변화가 있었는지 확인하세요',
    '센서 위치가 이탈되지 않았는지 확인하세요',
    '오작동으로 판단되면 해당 데이터를 무시하세요',
  ],
  out_of_range: [
    '센서 교정이 필요할 수 있습니다',
    '물리적 손상 여부를 확인하세요',
    '교체를 검토하세요',
  ],
};
```

### 3-3. SensorAlertsModule

**파일**: `backend/src/modules/sensor-alerts/sensor-alerts.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([SensorAlert, Device])],
  controllers: [SensorAlertsController],
  providers: [SensorAlertsService],
})
export class SensorAlertsModule {}
```

- `Device`를 import하되 **기존 DevicesModule에 의존하지 않음** (TypeOrmModule.forFeature로 직접 참조)
- `DataSource`를 inject하여 sensor_data raw query 실행

### 3-4. SensorAlertsController

**파일**: `backend/src/modules/sensor-alerts/sensor-alerts.controller.ts`

```typescript
@Controller('sensor-alerts')
@UseGuards(JwtAuthGuard)
export class SensorAlertsController {
  constructor(private alertsService: SensorAlertsService) {}

  private getEffectiveUserId(user: any): string {
    return user.role === 'farm_user' && user.parentUserId ? user.parentUserId : user.id;
  }

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('severity') severity?: string,
    @Query('resolved') resolved?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.alertsService.findAll(this.getEffectiveUserId(user), {
      severity, resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined, deviceId,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.alertsService.findOneWithStats(this.getEffectiveUserId(user), id);
  }

  @Put(':id/resolve')
  resolve(@CurrentUser() user: any, @Param('id') id: string) {
    return this.alertsService.resolve(this.getEffectiveUserId(user), id);
  }

  @Put(':id/snooze')
  snooze(@CurrentUser() user: any, @Param('id') id: string, @Body('days') days: number) {
    return this.alertsService.snooze(this.getEffectiveUserId(user), id, days);
  }
}
```

### 3-5. SensorAlertsService

**파일**: `backend/src/modules/sensor-alerts/sensor-alerts.service.ts`

```typescript
@Injectable()
export class SensorAlertsService {
  private readonly logger = new Logger(SensorAlertsService.name);

  constructor(
    @InjectRepository(SensorAlert) private alertRepo: Repository<SensorAlert>,
    @InjectRepository(Device) private deviceRepo: Repository<Device>,
    private dataSource: DataSource,
  ) {}

  // ── CRUD ──

  async findAll(userId: string, filters: { severity?: string; resolved?: boolean; deviceId?: string }) {
    const qb = this.alertRepo.createQueryBuilder('a')
      .where('a.user_id = :userId', { userId })
      .andWhere('(a.snoozed_until IS NULL OR a.snoozed_until < NOW())')
      .orderBy('a.created_at', 'DESC');

    if (filters.severity) qb.andWhere('a.severity = :severity', { severity: filters.severity });
    if (filters.resolved !== undefined) qb.andWhere('a.resolved = :resolved', { resolved: filters.resolved });
    if (filters.deviceId) qb.andWhere('a.device_id = :deviceId', { deviceId: filters.deviceId });

    return qb.getMany();
  }

  async findOneWithStats(userId: string, id: string) {
    const alert = await this.alertRepo.findOneOrFail({ where: { id, userId } });

    // 24h 통계 조회
    const stats = await this.dataSource.query(`
      SELECT
        MIN(value) as min_value,
        MAX(value) as max_value,
        MAX(value) - MIN(value) as delta,
        (SELECT value FROM sensor_data
         WHERE device_id = $1 AND sensor_type = $2
         ORDER BY time DESC LIMIT 1) as last_value
      FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2 AND time >= NOW() - INTERVAL '24 hours'
    `, [alert.deviceId, alert.sensorType]);

    return {
      ...alert,
      stats24h: stats[0] || null,
      actionGuides: ACTION_GUIDES[alert.alertType] || [],
    };
  }

  async resolve(userId: string, id: string) {
    await this.alertRepo.update({ id, userId }, { resolved: true, resolvedAt: new Date() });
    return this.alertRepo.findOneOrFail({ where: { id } });
  }

  async snooze(userId: string, id: string, days: number) {
    const until = new Date();
    until.setDate(until.getDate() + (days || 1));
    await this.alertRepo.update({ id, userId }, { snoozedUntil: until });
    return this.alertRepo.findOneOrFail({ where: { id } });
  }

  // ── 크론: 이상 감지 ──

  @Cron(CronExpression.EVERY_5_MINUTES)
  async detectAnomalies() {
    // 전체 사용자의 센서 장비 목록 조회
    const devices = await this.deviceRepo.find({
      where: { deviceType: 'sensor' },
      select: ['id', 'userId', 'name'],
    });

    for (const device of devices) {
      await this.checkDevice(device);
    }
  }

  private async checkDevice(device: { id: string; userId: string; name: string }) {
    // 해당 장비의 최신 데이터를 센서타입별로 조회
    const latestRows: { sensor_type: string; value: number; time: Date }[] =
      await this.dataSource.query(`
        SELECT DISTINCT ON (sensor_type) sensor_type, value, time
        FROM sensor_data
        WHERE device_id = $1
        ORDER BY sensor_type, time DESC
      `, [device.id]);

    // 센서 타입별 체크
    for (const sensorType of Object.keys(SENSOR_ALERT_RULES)) {
      const latest = latestRows.find(r => r.sensor_type === sensorType);
      const rule = SENSOR_ALERT_RULES[sensorType];

      // 1) 데이터 없음 체크
      await this.checkNoData(device, sensorType, latest);

      if (!latest) continue;

      // 2) 범위 이탈 체크
      await this.checkOutOfRange(device, sensorType, latest, rule);

      // 3) 급변 체크
      await this.checkSpike(device, sensorType, latest, rule);

      // 4) 값 고정 체크
      await this.checkFlatline(device, sensorType, latest, rule);
    }
  }

  // ── 개별 감지 로직 ──

  private async checkNoData(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { time: Date } | undefined,
  ) {
    if (!latest) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'critical',
        `${sensorType} 데이터 수신 이력 없음`, null, '데이터 없음');
      return;
    }
    const minutesAgo = (Date.now() - new Date(latest.time).getTime()) / 60000;
    if (minutesAgo >= NO_DATA_CRITICAL_MINUTES) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'critical',
        `${Math.round(minutesAgo / 60)}시간 동안 데이터 수신 없음`, null,
        `>${NO_DATA_CRITICAL_MINUTES}분`);
    } else if (minutesAgo >= NO_DATA_WARNING_MINUTES) {
      await this.createAlertIfNotExists(device, sensorType, 'no_data', 'warning',
        `${Math.round(minutesAgo)}분 동안 데이터 수신 없음`, null,
        `>${NO_DATA_WARNING_MINUTES}분`);
    }
  }

  private async checkOutOfRange(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    const v = Number(latest.value);
    if (v < rule.min || v > rule.max) {
      const dir = v < rule.min ? '최소' : '최대';
      await this.createAlertIfNotExists(device, sensorType, 'out_of_range', 'critical',
        `${sensorType} 값 ${v}${rule.unit} — 물리적 ${dir} 범위(${rule.min}~${rule.max}) 이탈`,
        v, `${rule.min}~${rule.max}${rule.unit}`);
    }
  }

  private async checkSpike(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    // 10분 전 값 조회
    const prev = await this.dataSource.query(`
      SELECT value FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
        AND time BETWEEN NOW() - INTERVAL '15 minutes' AND NOW() - INTERVAL '5 minutes'
      ORDER BY time DESC LIMIT 1
    `, [device.id, sensorType]);

    if (prev.length === 0) return;
    const delta = Math.abs(Number(latest.value) - Number(prev[0].value));
    if (delta > rule.spikeThreshold) {
      await this.createAlertIfNotExists(device, sensorType, 'spike', 'warning',
        `${sensorType} 10분 내 ${delta.toFixed(1)}${rule.unit} 급변 (임계: ${rule.spikeThreshold}${rule.unit})`,
        Number(latest.value), `>${rule.spikeThreshold}${rule.unit}/10분`);
    }
  }

  private async checkFlatline(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    latest: { value: number },
    rule: AlertRuleParams,
  ) {
    // 24시간 전 값 조회
    const old = await this.dataSource.query(`
      SELECT value FROM sensor_data
      WHERE device_id = $1 AND sensor_type = $2
        AND time BETWEEN NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS + 2} hours'
                      AND NOW() - INTERVAL '${FLATLINE_WINDOW_HOURS - 2} hours'
      ORDER BY time DESC LIMIT 1
    `, [device.id, sensorType]);

    if (old.length === 0) return;
    const delta = Math.abs(Number(latest.value) - Number(old[0].value));
    if (delta < rule.epsilon) {
      await this.createAlertIfNotExists(device, sensorType, 'flatline', 'warning',
        `${sensorType} ${FLATLINE_WINDOW_HOURS}시간 동안 변화량 ${delta.toFixed(2)}${rule.unit} (임계: ${rule.epsilon}${rule.unit})`,
        Number(latest.value), `변화<${rule.epsilon}${rule.unit}/${FLATLINE_WINDOW_HOURS}h`);
    }
  }

  // ── 중복 방지 ──

  private async createAlertIfNotExists(
    device: { id: string; userId: string; name: string },
    sensorType: string,
    alertType: string,
    severity: string,
    message: string,
    value: number | null,
    threshold: string,
  ) {
    // 동일 조합 미해결 알림 존재 시 생성 안 함
    const existing = await this.alertRepo.findOne({
      where: {
        deviceId: device.id,
        sensorType,
        alertType: alertType as any,
        resolved: false,
      },
    });
    if (existing) return;

    const alert = this.alertRepo.create({
      userId: device.userId,
      deviceId: device.id,
      deviceName: device.name,
      sensorType,
      alertType: alertType as any,
      severity: severity as any,
      message,
      value,
      threshold,
    });
    await this.alertRepo.save(alert);
    this.logger.warn(`[Alert] ${device.name} / ${sensorType}: ${message}`);
  }
}
```

---

## 4. 프론트엔드 설계 — 수확 예측

### 4-1. 작물 프리셋 상수

**파일**: `frontend/src/utils/harvest-presets.ts`

```typescript
export interface CropPreset {
  name: string;
  variety: string;
  growDays: number;
  stages: string[];
}

// 강원도 횡성군 둔내 기준
export const CROP_PRESETS: CropPreset[] = [
  { name: '방울토마토', variety: '대추방울', growDays: 100,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '방울토마토', variety: '미니찰', growDays: 90,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '방울토마토', variety: '탐스러운', growDays: 110,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '딸기', variety: '설향', growDays: 120,
    stages: ['정식', '활착', '개화', '착과', '수확'] },
  { name: '오이', variety: '다다기', growDays: 60,
    stages: ['정식', '생장', '수확'] },
  { name: '고추', variety: '청양', growDays: 150,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
];

export function getStagesForCrop(cropName: string): string[] {
  const preset = CROP_PRESETS.find(p => p.name === cropName);
  return preset?.stages || ['파종', '생장', '수확'];
}
```

### 4-2. API 클라이언트

**파일**: `frontend/src/api/harvest.api.ts`

```typescript
import { apiClient } from './client';

export interface CropBatch {
  id: string;
  userId: string;
  cropName: string;
  variety: string | null;
  houseName: string;
  sowDate: string;
  growDays: number;
  stage: string;
  memo: string | null;
  status: 'active' | 'completed';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBatchRequest {
  cropName: string;
  variety?: string;
  houseName: string;
  sowDate: string;
  growDays: number;
  stage?: string;
  memo?: string;
}

export const harvestApi = {
  getBatches: (status?: string) =>
    apiClient.get<CropBatch[]>('/harvest/batches', { params: { status } }),
  getBatch: (id: string) =>
    apiClient.get<CropBatch>(`/harvest/batches/${id}`),
  createBatch: (data: CreateBatchRequest) =>
    apiClient.post<CropBatch>('/harvest/batches', data),
  updateBatch: (id: string, data: Partial<CreateBatchRequest>) =>
    apiClient.put<CropBatch>(`/harvest/batches/${id}`, data),
  completeBatch: (id: string) =>
    apiClient.put<CropBatch>(`/harvest/batches/${id}/complete`),
  cloneBatch: (id: string, houseName: string) =>
    apiClient.post<CropBatch>(`/harvest/batches/${id}/clone`, { houseName }),
  deleteBatch: (id: string) =>
    apiClient.delete(`/harvest/batches/${id}`),
};
```

### 4-3. Harvest.vue 화면 구조

**파일**: `frontend/src/views/Harvest.vue`

```
<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <div>
        <h2>수확 관리</h2>
        <p class="page-description">작물 배치별 수확 예측 및 진행 관리</p>
      </div>
      <button class="btn-primary" @click="openModal()">+ 배치 추가</button>
    </header>

    <!-- 탭 -->
    <div class="tab-bar">
      <button :class="['tab', { active: tab === 'active' }]" @click="tab = 'active'">
        진행중 ({{ activeBatches.length }})
      </button>
      <button :class="['tab', { active: tab === 'completed' }]" @click="tab = 'completed'">
        완료 ({{ completedBatches.length }})
      </button>
    </div>

    <!-- 알림 섹션: 수확 임박 + 기한 경과 -->
    <div v-if="tab === 'active'" class="alert-sections">
      <!-- 기한 경과 (D-day < 0) -->
      <div v-if="overdueBatches.length > 0" class="alert-section danger">
        <h4>기한 경과 ({{ overdueBatches.length }})</h4>
        <BatchCard v-for="b in overdueBatches" :key="b.id" :batch="b" ... />
      </div>
      <!-- 7일 이내 수확 예정 -->
      <div v-if="soonBatches.length > 0" class="alert-section warn">
        <h4>7일 이내 수확 예정 ({{ soonBatches.length }})</h4>
        <BatchCard v-for="b in soonBatches" :key="b.id" :batch="b" ... />
      </div>
    </div>

    <!-- 배치 리스트 -->
    <div class="batch-list">
      <BatchCard
        v-for="batch in displayBatches"
        :key="batch.id"
        :batch="batch"
        @edit="openModal(batch)"
        @complete="completeBatch(batch.id)"
        @clone="cloneBatch(batch)"
        @delete="deleteBatch(batch.id)"
        @stage-change="updateStage(batch.id, $event)"
      />
    </div>

    <!-- 추가/수정 모달 -->
    <BatchFormModal v-if="showModal" :batch="editingBatch" @save="saveBatch" @close="showModal = false" />
  </div>
</template>
```

#### BatchCard 인라인 컴포넌트 구조

```html
<div class="batch-card">
  <div class="batch-header">
    <div class="batch-title">
      <h3>{{ batch.cropName }} {{ batch.variety ? `/ ${batch.variety}` : '' }}</h3>
      <span class="batch-house">{{ batch.houseName }}</span>
    </div>
    <div class="batch-dday" :class="ddayClass">{{ ddayText }}</div>
    <!-- 3점 메뉴 -->
    <div class="batch-menu">...</div>
  </div>
  <div class="batch-info">
    <span>파종: {{ batch.sowDate }}</span>
    <span>·</span>
    <span>생육: {{ batch.growDays }}일</span>
  </div>
  <div class="batch-harvest">예상 수확: {{ harvestDate }}</div>
  <!-- 진행률 바 -->
  <div class="progress-bar">
    <div class="progress-fill" :style="{ width: progress + '%' }"></div>
  </div>
  <div class="progress-label">{{ progress }}%</div>
  <!-- 단계 드롭다운 -->
  <select class="stage-select" :value="batch.stage" @change="$emit('stage-change', $event.target.value)">
    <option v-for="s in stages" :key="s" :value="s">{{ s }}</option>
  </select>
</div>
```

#### 계산 로직 (computed)

```typescript
function calcBatchInfo(batch: CropBatch) {
  const sow = new Date(batch.sowDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const harvestDate = new Date(sow);
  harvestDate.setDate(harvestDate.getDate() + batch.growDays);

  const dday = Math.ceil((harvestDate.getTime() - today.getTime()) / 86400000);
  const elapsed = Math.ceil((today.getTime() - sow.getTime()) / 86400000);
  const progress = Math.round(Math.max(0, Math.min(1, elapsed / batch.growDays)) * 100);

  return {
    harvestDate: harvestDate.toISOString().slice(0, 10),
    dday,
    ddayText: dday > 0 ? `D-${dday}` : dday === 0 ? 'D-Day' : `D+${Math.abs(dday)}`,
    ddayClass: dday < 0 ? 'overdue' : dday <= 7 ? 'soon' : 'normal',
    progress,
  };
}
```

### 4-4. BatchFormModal 구조

```html
<div class="modal-overlay">
  <div class="modal-content">
    <h3>{{ isEdit ? '배치 수정' : '배치 추가' }}</h3>

    <!-- 프리셋 선택 -->
    <div class="form-group">
      <label>프리셋</label>
      <select v-model="selectedPreset" @change="applyPreset">
        <option value="">직접 입력</option>
        <option v-for="p in CROP_PRESETS" :key="p.name+p.variety"
                :value="p.name+'|'+p.variety">
          {{ p.name }} ({{ p.variety }}) — {{ p.growDays }}일
        </option>
      </select>
    </div>

    <!-- 작물명 -->
    <div class="form-group">
      <label>작물명 *</label>
      <input v-model="form.cropName" placeholder="예: 방울토마토" />
    </div>

    <!-- 품종 -->
    <div class="form-group">
      <label>품종</label>
      <input v-model="form.variety" placeholder="예: 대추방울" />
    </div>

    <!-- 하우스/구역 -->
    <div class="form-group">
      <label>하우스/구역 *</label>
      <input v-model="form.houseName" placeholder="예: 하우스 1" />
    </div>

    <!-- 파종일 -->
    <div class="form-group">
      <label>파종일(정식일) *</label>
      <input type="date" v-model="form.sowDate" />
    </div>

    <!-- 생육기간 -->
    <div class="form-group">
      <label>생육기간 (일) *</label>
      <input type="number" v-model.number="form.growDays" min="1" max="365" />
    </div>

    <!-- 메모 -->
    <div class="form-group">
      <label>메모</label>
      <textarea v-model="form.memo" maxlength="200" rows="2"></textarea>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" @click="$emit('close')">취소</button>
      <button class="btn-primary" @click="save" :disabled="!isValid">저장</button>
    </div>
  </div>
</div>
```

---

## 5. 프론트엔드 설계 — 센서 이상 감지

### 5-1. API 클라이언트

**파일**: `frontend/src/api/sensor-alerts.api.ts`

```typescript
import { apiClient } from './client';

export interface SensorAlert {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string | null;
  sensorType: string;
  alertType: 'no_data' | 'flatline' | 'spike' | 'out_of_range';
  severity: 'warning' | 'critical';
  message: string;
  value: number | null;
  threshold: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface AlertDetail extends SensorAlert {
  stats24h: {
    min_value: number | null;
    max_value: number | null;
    delta: number | null;
    last_value: number | null;
  } | null;
  actionGuides: string[];
}

export const sensorAlertsApi = {
  getAlerts: (params?: { severity?: string; resolved?: string; deviceId?: string }) =>
    apiClient.get<SensorAlert[]>('/sensor-alerts', { params }),
  getAlert: (id: string) =>
    apiClient.get<AlertDetail>(`/sensor-alerts/${id}`),
  resolveAlert: (id: string) =>
    apiClient.put(`/sensor-alerts/${id}/resolve`),
  snoozeAlert: (id: string, days: number) =>
    apiClient.put(`/sensor-alerts/${id}/snooze`, { days }),
};
```

### 5-2. Alerts.vue 화면 구조

**파일**: `frontend/src/views/Alerts.vue`

```
<template>
  <div class="page-container">
    <!-- 헤더 -->
    <header class="page-header">
      <div>
        <h2>센서 알림</h2>
        <p class="page-description">센서 이상 감지 및 조치 안내</p>
      </div>
      <span v-if="unresolvedCount > 0" class="unresolved-badge">{{ unresolvedCount }}</span>
    </header>

    <!-- 필터 칩 -->
    <div class="filter-bar">
      <button v-for="f in filterOptions" :key="f.value"
              :class="['filter-chip', { active: filter === f.value }]"
              @click="filter = f.value">
        {{ f.label }}
      </button>
    </div>

    <!-- 알림 카드 리스트 -->
    <div v-if="loading" class="loading-state">알림을 불러오는 중...</div>
    <div v-else-if="filteredAlerts.length === 0" class="empty-state">
      <h3>알림이 없습니다</h3>
      <p>센서가 정상적으로 작동하고 있습니다.</p>
    </div>
    <div v-else class="alerts-list">
      <div v-for="alert in filteredAlerts" :key="alert.id"
           class="alert-card" :class="[alert.severity, { resolved: alert.resolved }]"
           @click="openDetail(alert)">
        <!-- 심각도 아이콘 + 뱃지 -->
        <div class="alert-severity">
          <span class="severity-icon">{{ alert.severity === 'critical' ? '🔴' : '🟡' }}</span>
          <span :class="['severity-badge', alert.severity]">
            {{ alert.severity === 'critical' ? '심각' : '경고' }}
          </span>
        </div>
        <!-- 내용 -->
        <div class="alert-content">
          <div class="alert-title">{{ alert.deviceName || alert.deviceId }}</div>
          <div class="alert-meta">
            <span class="alert-type">{{ alertTypeLabel(alert.alertType) }}</span>
            <span>·</span>
            <span class="alert-sensor">{{ sensorTypeLabel(alert.sensorType) }}</span>
          </div>
          <div class="alert-message">{{ alert.message }}</div>
          <div class="alert-time">{{ formatTimeAgo(alert.createdAt) }}</div>
        </div>
        <!-- 액션 -->
        <div class="alert-actions" @click.stop>
          <button v-if="!alert.resolved" class="btn-sm" @click="resolveAlert(alert.id)">해결</button>
        </div>
      </div>
    </div>

    <!-- 상세 모달 -->
    <AlertDetailModal
      v-if="selectedAlert"
      :alert-id="selectedAlert.id"
      @close="selectedAlert = null"
      @resolve="resolveAlert($event)"
      @snooze="snoozeAlert($event.id, $event.days)"
    />
  </div>
</template>
```

#### AlertDetailModal 구조

```html
<div class="modal-overlay">
  <div class="modal-content">
    <div class="detail-header">
      <h3>{{ alertTypeLabel(detail.alertType) }} 감지</h3>
      <span :class="['severity-badge', detail.severity]">{{ detail.severity === 'critical' ? '심각' : '경고' }}</span>
    </div>

    <div class="detail-info">
      <div>센서: {{ detail.deviceName }} / {{ sensorTypeLabel(detail.sensorType) }}</div>
      <div>감지 시각: {{ formatDate(detail.createdAt) }}</div>
    </div>

    <!-- 24h 숫자 요약 -->
    <div v-if="detail.stats24h" class="stats-grid">
      <div class="stat-item"><span class="stat-label">최근 24h 최소</span><span class="stat-value">{{ detail.stats24h.min_value ?? '-' }}</span></div>
      <div class="stat-item"><span class="stat-label">최근 24h 최대</span><span class="stat-value">{{ detail.stats24h.max_value ?? '-' }}</span></div>
      <div class="stat-item"><span class="stat-label">변화폭</span><span class="stat-value">{{ detail.stats24h.delta ?? '-' }}</span></div>
      <div class="stat-item"><span class="stat-label">마지막 값</span><span class="stat-value">{{ detail.stats24h.last_value ?? '-' }}</span></div>
    </div>

    <!-- 감지 이유 -->
    <div class="detail-reason">
      <h4>감지 이유</h4>
      <p>{{ detail.message }}</p>
    </div>

    <!-- 조치 가이드 -->
    <div class="detail-guides">
      <h4>조치 가이드</h4>
      <ul>
        <li v-for="(guide, i) in detail.actionGuides" :key="i">{{ guide }}</li>
      </ul>
    </div>

    <!-- 액션 버튼 -->
    <div class="modal-actions">
      <button class="btn-secondary" @click="$emit('close')">닫기</button>
      <button class="btn-secondary" @click="$emit('snooze', { id: detail.id, days: 1 })">1일 스누즈</button>
      <button class="btn-secondary" @click="$emit('snooze', { id: detail.id, days: 7 })">1주 스누즈</button>
      <button v-if="!detail.resolved" class="btn-primary" @click="$emit('resolve', detail.id)">해결 처리</button>
    </div>
  </div>
</div>
```

#### 헬퍼 함수

```typescript
const ALERT_TYPE_LABELS: Record<string, string> = {
  no_data: '데이터 없음',
  flatline: '값 고정',
  spike: '급변',
  out_of_range: '범위 이탈',
};

const SENSOR_TYPE_LABELS: Record<string, string> = {
  temperature: '온도',
  humidity: '습도',
  co2: 'CO2',
  soil_moisture: '토양습도',
  uv: 'UV',
  dew_point: '이슬점',
  rainfall: '강우량',
};
```

---

## 6. 라우터 + 네비게이션 수정

### 6-1. router/index.ts — 2개 라우트 추가

```typescript
// 리포트 다음에 추가
{
  path: '/harvest',
  name: 'harvest',
  component: () => import('../views/Harvest.vue'),
  meta: { title: '수확 관리', requiresAuth: true }
},
{
  path: '/alerts',
  name: 'alerts',
  component: () => import('../views/Alerts.vue'),
  meta: { title: '센서 알림', requiresAuth: true }
},
```

### 6-2. App.vue — 네비게이션 링크 추가

데스크탑 사이드바 (리포트 다음, 사용자 관리 전):

```html
<router-link to="/harvest" class="sidebar-link">
  <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4-4 8-7.5 8-12a8 8 0 1 0-16 0c0 4.5 4 8 8 12z"/><circle cx="12" cy="10" r="3"/></svg></span>
  <span>수확 관리</span>
</router-link>
<router-link to="/alerts" class="sidebar-link">
  <span class="link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
  <span>센서 알림</span>
</router-link>
```

모바일 드로어에도 동일 (+ `@click="isDrawerOpen = false"` 추가).

### 6-3. app.module.ts — 모듈 추가

```typescript
import { HarvestModule } from './modules/harvest/harvest.module';
import { SensorAlertsModule } from './modules/sensor-alerts/sensor-alerts.module';

@Module({
  imports: [
    // ... 기존 모듈들
    HarvestModule,
    SensorAlertsModule,
  ],
})
```

---

## 7. 파일 변경 목록

### 신규 파일 (15개)

| # | 파일 | 설명 |
|---|------|------|
| N1 | `backend/src/modules/harvest/harvest.module.ts` | 모듈 |
| N2 | `backend/src/modules/harvest/harvest.controller.ts` | API (7개 엔드포인트) |
| N3 | `backend/src/modules/harvest/harvest.service.ts` | CRUD |
| N4 | `backend/src/modules/harvest/entities/crop-batch.entity.ts` | 엔티티 |
| N5 | `backend/src/modules/harvest/dto/create-batch.dto.ts` | DTO |
| N6 | `frontend/src/api/harvest.api.ts` | API 클라이언트 |
| N7 | `frontend/src/views/Harvest.vue` | 수확 관리 화면 |
| N8 | `frontend/src/utils/harvest-presets.ts` | 작물 프리셋 |
| N9 | `backend/src/modules/sensor-alerts/sensor-alerts.module.ts` | 모듈 |
| N10 | `backend/src/modules/sensor-alerts/sensor-alerts.controller.ts` | API |
| N11 | `backend/src/modules/sensor-alerts/sensor-alerts.service.ts` | 룰 엔진 + CRUD |
| N12 | `backend/src/modules/sensor-alerts/entities/sensor-alert.entity.ts` | 엔티티 |
| N13 | `backend/src/modules/sensor-alerts/sensor-alert-rules.ts` | 감지 룰 상수 |
| N14 | `frontend/src/api/sensor-alerts.api.ts` | API 클라이언트 |
| N15 | `frontend/src/views/Alerts.vue` | 알림 화면 |

### 수정 파일 (4개)

| # | 파일 | 변경 |
|---|------|------|
| M1 | `backend/database/schema.sql` | crop_batches + sensor_alerts DDL 추가 |
| M2 | `backend/src/app.module.ts` | HarvestModule + SensorAlertsModule import |
| M3 | `frontend/src/router/index.ts` | /harvest + /alerts 라우트 추가 |
| M4 | `frontend/src/App.vue` | 데스크탑/모바일 네비게이션 링크 2개 추가 |

---

## 8. 구현 순서

### Phase 1: DB 스키마 (M1)

| Step | 작업 |
|------|------|
| 1-1 | `schema.sql`에 crop_batches + sensor_alerts CREATE TABLE 추가 |
| 1-2 | DB에 직접 실행 (또는 서버 재시작 시 수동 적용) |

### Phase 2: 수확 예측 백엔드 (N1~N5, M2 일부)

| Step | 파일 | 작업 |
|------|------|------|
| 2-1 | `crop-batch.entity.ts` | 엔티티 정의 |
| 2-2 | `create-batch.dto.ts` | CreateBatchDto + UpdateBatchDto |
| 2-3 | `harvest.service.ts` | findAll/findOne/create/update/complete/clone/remove |
| 2-4 | `harvest.controller.ts` | 7개 엔드포인트 + getEffectiveUserId |
| 2-5 | `harvest.module.ts` | 모듈 등록 |
| 2-6 | `app.module.ts` | HarvestModule import 추가 |

### Phase 3: 수확 예측 프론트엔드 (N6~N8, M3/M4 일부)

| Step | 파일 | 작업 |
|------|------|------|
| 3-1 | `harvest-presets.ts` | 프리셋 상수 + getStagesForCrop |
| 3-2 | `harvest.api.ts` | CropBatch 타입 + API 메서드 7개 |
| 3-3 | `Harvest.vue` | 리스트(탭/카드/진행률/D-day) + BatchFormModal |
| 3-4 | `router/index.ts` | /harvest 라우트 추가 |
| 3-5 | `App.vue` | 수확 관리 네비게이션 (데스크탑 + 모바일) |

### Phase 4: 센서 이상 감지 백엔드 (N9~N13, M2 일부)

| Step | 파일 | 작업 |
|------|------|------|
| 4-1 | `sensor-alert.entity.ts` | 엔티티 정의 |
| 4-2 | `sensor-alert-rules.ts` | 감지 룰 + 임계값 + 조치가이드 상수 |
| 4-3 | `sensor-alerts.service.ts` | CRUD + Cron detectAnomalies + 4개 check 메서드 |
| 4-4 | `sensor-alerts.controller.ts` | 4개 엔드포인트 |
| 4-5 | `sensor-alerts.module.ts` | 모듈 등록 |
| 4-6 | `app.module.ts` | SensorAlertsModule import 추가 |

### Phase 5: 센서 이상 감지 프론트엔드 (N14~N15, M3/M4 일부)

| Step | 파일 | 작업 |
|------|------|------|
| 5-1 | `sensor-alerts.api.ts` | SensorAlert 타입 + API 메서드 4개 |
| 5-2 | `Alerts.vue` | 인박스(필터칩/카드) + AlertDetailModal(통계/가이드/스누즈) |
| 5-3 | `router/index.ts` | /alerts 라우트 추가 |
| 5-4 | `App.vue` | 센서 알림 네비게이션 (데스크탑 + 모바일) |

### Phase 6: 빌드 검증

| Step | 작업 |
|------|------|
| 6-1 | `cd backend && npm run build` |
| 6-2 | `cd frontend && npx vue-tsc --noEmit && npm run build` |

---

## 9. 검증 항목 (Gap Analysis용)

| # | 카테고리 | 검증 항목 |
|---|----------|----------|
| 1 | DB | crop_batches 테이블 DDL (schema.sql) |
| 2 | DB | sensor_alerts 테이블 DDL (schema.sql) |
| 3 | Backend Harvest | CropBatch entity 정의 |
| 4 | Backend Harvest | CreateBatchDto + class-validator |
| 5 | Backend Harvest | 7개 API 엔드포인트 (CRUD + complete + clone) |
| 6 | Backend Harvest | getEffectiveUserId 패턴 |
| 7 | Backend Alerts | SensorAlert entity 정의 |
| 8 | Backend Alerts | SENSOR_ALERT_RULES 7개 센서 파라미터 |
| 9 | Backend Alerts | Cron 5분 주기 detectAnomalies |
| 10 | Backend Alerts | 4개 감지 로직 (no_data/flatline/spike/out_of_range) |
| 11 | Backend Alerts | 중복 알림 방지 (createAlertIfNotExists) |
| 12 | Backend Alerts | findOneWithStats 24h 통계 + actionGuides |
| 13 | Backend Alerts | resolve + snooze API |
| 14 | Frontend | harvest-presets.ts 프리셋 6종 |
| 15 | Frontend | harvest.api.ts 타입 + 7개 메서드 |
| 16 | Frontend Harvest | Harvest.vue 탭(진행중/완료) + 카드 + D-day + 진행률 |
| 17 | Frontend Harvest | BatchFormModal 프리셋 연동 + 검증 |
| 18 | Frontend Harvest | 수확 임박(7일)/기한 경과 자동 필터 |
| 19 | Frontend Alerts | sensor-alerts.api.ts 타입 + 4개 메서드 |
| 20 | Frontend Alerts | Alerts.vue 필터 칩 + 카드 + 심각도 |
| 21 | Frontend Alerts | AlertDetailModal 24h 통계 + 조치 가이드 + 스누즈 |
| 22 | Router | /harvest + /alerts 라우트 |
| 23 | Navigation | 데스크탑 + 모바일 메뉴 링크 |
| 24 | AppModule | HarvestModule + SensorAlertsModule import |
| 25 | Build | 백엔드 + 프론트엔드 빌드 통과 |
