# Design — notification-taxonomy (알림 정책 구현 설계)

**Created**: 2026-07-15
**Updated**: 2026-07-20 — **상태: 웹 미적용 / iOS·Android 앱 프로젝트 참고 문서로 전환**
**Depends on**: `docs/01-plan/features/notification-taxonomy.plan.md`
**Phase**: Design (참고 문서)

> ⚠️ **적용 범위 결정 (2026-07-20)**
> 웹 개편은 리스크 대비 이득 부족 → 미적용. 앱 신규 프로젝트에서 이 설계 그대로 사용.
>
> **앱 프로젝트로 그대로 이식 가능한 항목**:
> - DB 스키마 (notifications, preferences, device_tokens) — 앱 백엔드에서 신설
> - 카테고리 21종 + 심각도 매핑
> - NotificationService.dispatch() 흐름 (dedup, 방해금지, 옵트인)
> - PushProvider 어댑터 (Expo/FCM/APNs)
> - 딥링크 표
> - 90일 자동 정리 cron
>
> **앱 프로젝트에서 재검토 필요**:
> - "폼 검증 → formError 마이그레이션" — 앱은 처음부터 폼 검증을 인라인 에러로 (센터 저장 X)
> - 기존 sensor-alerts.service 리팩터 부분은 무시 (웹 코드)
> - 프론트 notification.store 개편 부분 무시 — 앱은 새 store 로 처음부터 작성

---

## 1. 전체 아키텍처

```
┌─ Event Source ───────────────────────────────────┐
│  · sensor-alerts.service (createAlertIfNotExists)│
│  · gateway-manager (offline/auto-restart)         │
│  · automation-runner (성공/실패)                   │
│  · fallback-config (mode/이벤트 broadcast)         │
│  · zigbee bridge (device 페어링/배터리 리포트)     │
│  · [NEW] battery-watchdog / disk-watchdog          │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─ notifications module (신규) ────────────────────┐
│  NotificationService                              │
│   ├─ dispatch(userId, category, severity, ...)   │
│   ├─ 카테고리별 옵트인 조회                        │
│   ├─ dedup (같은 key 1시간)                        │
│   ├─ 방해금지 시간대 체크                          │
│   └─ 채널별 전달                                    │
│         ├─ WebSocket emit('notification:new')     │
│         ├─ DB insert (notifications 테이블)         │
│         └─ Push queue enqueue (Bull)               │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─ push-worker (Bull processor) ──────────────────┐
│  · FCM (Android) + APNs (iOS)                     │
│  · Expo Push Token 지원 (Expo 앱)                 │
│  · deep link 페이로드 포함                          │
└──────────────────────────────────────────────────┘

Frontend
  · notification.store — 인앱 토스트 + 벨 아이콘 (기존)
  · notification:new 소켓 이벤트로 실시간 반영
  · 알림 설정 화면 (신규) — 옵트인 토글 + 방해금지 시각
```

---

## 2. DB 스키마

### 2.1 마이그레이션 `036_notifications.sql`

```sql
-- 036: 통합 알림 저장소 + 사용자 옵트인 + 디바이스 토큰
-- 기존 sensor_alerts 는 그대로 유지 (센서 이상 도메인 이력용).
-- notifications 는 앱 푸시/알림센터 통합 스트림.

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  category      VARCHAR(40) NOT NULL,       -- 5장 카테고리 코드
  severity      VARCHAR(10) NOT NULL,       -- critical|warning|info
  title         VARCHAR(120) NOT NULL,
  body          TEXT NOT NULL,
  dedup_key     VARCHAR(200),               -- 같은 이벤트 반복 억제용
  deep_link     VARCHAR(200),               -- 앱/웹 라우트
  metadata      JSONB,                      -- 원본 이벤트 참조 (alertId, deviceId 등)
  read_at       TIMESTAMPTZ,
  delivered     JSONB DEFAULT '{"inapp":true,"push":false}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_dedup ON notifications(user_id, dedup_key, created_at DESC) WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                       UUID PRIMARY KEY,
  channel_sensor_critical       BOOLEAN NOT NULL DEFAULT TRUE,
  channel_sensor_warning        BOOLEAN NOT NULL DEFAULT TRUE,
  channel_automation_failure    BOOLEAN NOT NULL DEFAULT TRUE,
  channel_failover              BOOLEAN NOT NULL DEFAULT TRUE,
  channel_daily_summary         BOOLEAN NOT NULL DEFAULT TRUE,
  channel_battery               BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start             SMALLINT NOT NULL DEFAULT 22,   -- 0-23
  quiet_hours_end               SMALLINT NOT NULL DEFAULT 7,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  platform      VARCHAR(10) NOT NULL,        -- ios|android|expo|web
  token         TEXT NOT NULL UNIQUE,
  device_label  VARCHAR(80),                 -- 'iPhone 14 / OS 17.4'
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_device_tokens_user ON notification_device_tokens(user_id);
```

### 2.2 호환성
- 기존 `sensor_alerts` 유지 — 센서 이상 도메인 전용 상세 (알림 페이지 /alerts)
- `notifications` 는 여기 참조하는 통합 스트림 (metadata.alertId 로 링크)
- `centerItems` (Pinia) 는 로그인 후 백엔드 `notifications` 로 hydrate

---

## 3. 카테고리 & 심각도 매핑

### 3.1 카테고리 코드 (백엔드 표준)

| category | 심각도 | 옵트인 필드 | 트리거 |
|---|---|---|---|
| `sensor.no_data.critical` | critical | channel_sensor_critical | 센서 6시간 무데이터 |
| `sensor.no_data.warning` | warning | channel_sensor_warning | 센서 1시간 무데이터 |
| `sensor.spike` | warning | channel_sensor_warning | 10분 급변 |
| `sensor.out_of_range` | warning | channel_sensor_warning | 물리 범위 초과 |
| `sensor.flatline` | warning | channel_sensor_warning | 24h 변화 없음 |
| `sensor.unstable` | warning | channel_sensor_warning | 6h 내 3회+ flapping |
| `gateway.offline` | critical | channel_sensor_critical | 30분+ 오프라인 |
| `gateway.disk_full` | warning | channel_sensor_warning | 사용률 90%+ |
| `gateway.auto_recovery` | info | (없음, 항상) | gpio-agent 자동 재시작 성공 |
| `gateway.pairing_failed` | info | (없음) | Zigbee 페어링 실패 |
| `gateway.pairing_new` | info | (없음) | 신규 페어링 감지 |
| `automation.failed` | warning | channel_automation_failure | 자동제어 룰 실행 실패 |
| `failover.entered` | critical | channel_failover | 페일오버 모드 진입 |
| `failover.irrigation_stop_failed` | critical | channel_failover | 관수 자동 종료 실패 |
| `failover.interlock_violation` | critical | channel_failover | 개폐기 인터록 위반 |
| `failover.rain_close` | critical | channel_failover | 우적 → 개폐기 CLOSE |
| `failover.rain_close_action` | warning | channel_failover | 우천 자동 폐쇄 실행 요약 |
| `failover.event` | info | channel_failover | 페일오버 스케줄 이벤트 |
| `battery.low` | warning | channel_battery | 배터리 20% 이하 |
| `battery.critical` | critical | channel_battery | 배터리 5% 이하 |
| `system.daily_summary` | info | channel_daily_summary | 매일 08:00 |

### 3.2 severity → OS 표기

| severity | iOS interruption | Android importance | 사운드 |
|---|---|---|---|
| critical | `timeSensitive` | HIGH (heads-up) | 사운드+진동 |
| warning | `active` | DEFAULT | 무음, 짧은 진동 |
| info | `passive` | LOW | 무음, 알림센터에만 |

---

## 4. Backend — 신규 모듈 명세

### 4.1 `notifications.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, NotificationDeviceToken]),
    BullModule.registerQueue({ name: 'notification-push' }),
  ],
  providers: [
    NotificationService,        // 발송 진입점
    NotificationPushProcessor,  // Bull worker (FCM/APNs)
    PushProvider,               // FCM/APNs 어댑터
  ],
  controllers: [NotificationController, NotificationPreferenceController, DeviceTokenController],
  exports: [NotificationService],
})
export class NotificationsModule {}
```

### 4.2 `NotificationService.dispatch()`

```typescript
async dispatch(input: {
  userId: string
  category: NotificationCategory
  title: string
  body: string
  dedupKey?: string            // 예: `sensor.${deviceId}.${sensorType}.spike`
  deepLink?: string            // 예: `/alerts?id=${alertId}`
  metadata?: Record<string, unknown>
  forcePush?: boolean          // Critical 는 옵트인 무시하고 강제 발송
}) {
  const cfg = CATEGORY_CONFIG[input.category]   // severity + optIn field
  const prefs = await this.prefRepo.findOne({ where: { userId } }) ?? DEFAULT_PREFS

  // ── 옵트인 체크 (critical + forcePush 는 통과) ──
  const optedIn = cfg.optInField ? prefs[cfg.optInField] : true
  if (!optedIn && !input.forcePush && cfg.severity !== 'critical') return { skipped: 'opt-out' }

  // ── dedup (1시간 창) ──
  if (input.dedupKey) {
    const recent = await this.notiRepo.findOne({
      where: {
        userId, dedupKey: input.dedupKey,
        createdAt: MoreThan(new Date(Date.now() - 60 * 60_000)),
      },
    })
    if (recent) return { skipped: 'dedup', recentId: recent.id }
  }

  // ── DB insert (인앱은 항상 저장) ──
  const noti = await this.notiRepo.save(
    this.notiRepo.create({
      userId, category: input.category,
      severity: cfg.severity, title: input.title, body: input.body,
      dedupKey: input.dedupKey ?? null,
      deepLink: input.deepLink ?? null,
      metadata: input.metadata ?? null,
      delivered: { inapp: true, push: false },
    }),
  )

  // ── WebSocket 실시간 push (인앱 반영) ──
  this.events.server.to(`user:${userId}`).emit('notification:new', {
    id: noti.id, category: noti.category, severity: noti.severity,
    title: noti.title, body: noti.body, deepLink: noti.deepLink,
    createdAt: noti.createdAt,
  })

  // ── 방해금지 체크 (critical 은 무시) ──
  const inQuietHours = prefs.quietHoursEnabled
    && this.isInQuietHours(new Date(), prefs.quietHoursStart, prefs.quietHoursEnd)
  const sendPushNow = cfg.severity === 'critical' || !inQuietHours

  if (sendPushNow) {
    await this.pushQueue.add('send', { notificationId: noti.id }, {
      attempts: 3, backoff: { type: 'exponential', delay: 1000 },
    })
  } else {
    // 방해금지 시간대 → 아침 요약 큐로 스케줄
    await this.pushQueue.add(
      'send', { notificationId: noti.id, deferredUntil: this.nextMorning8am() },
      { delay: this.msUntilNextMorning() },
    )
  }
  return { notificationId: noti.id }
}
```

### 4.3 `PushProvider` 인터페이스

```typescript
export interface PushProvider {
  send(payload: {
    token: string
    platform: 'ios' | 'android' | 'expo' | 'web'
    severity: 'critical' | 'warning' | 'info'
    title: string
    body: string
    deepLink?: string
    category: string
    dedupKey?: string
  }): Promise<{ success: boolean; error?: string }>
}
```

### 4.4 API 엔드포인트

| Method | Path | 용도 |
|---|---|---|
| GET | `/api/notifications?unreadOnly=true&limit=50` | 인앱 알림 센터 hydrate |
| PATCH | `/api/notifications/:id/read` | 개별 읽음 처리 |
| PATCH | `/api/notifications/read-all` | 전체 읽음 |
| DELETE | `/api/notifications/:id` | 삭제 |
| GET | `/api/notification-preferences` | 옵트인 설정 조회 |
| PUT | `/api/notification-preferences` | 옵트인 저장 |
| POST | `/api/notification-tokens` | 디바이스 토큰 등록 (앱 최초 실행 시) |
| DELETE | `/api/notification-tokens/:token` | 로그아웃 시 토큰 해제 |

### 4.5 신규 감지 워커

**`BatteryWatchdog`** — `@Cron('*/10 * * * *')` (10분)
- `devices` 중 `sensorData.battery <= 20` → `battery.low`
- `<= 5` → `battery.critical` (forcePush=true)

**`DiskWatchdog`** — 각 게이트웨이가 매 5분 emit 하는 `gateway/health` MQTT 페이로드 `disk.usage_pct` 감시
- `>= 90` → `gateway.disk_full`

**`gateway.offline` 30분 승격** — 기존 sensor-alerts flow 에서 `no_data critical` 이 30분 이상 지속 시 dispatch (기존 로직 재사용)

---

## 5. Frontend 변경

### 5.1 `notification.store` 수정

- `centerItems` 를 로그인 후 백엔드 hydrate:
  ```typescript
  async function hydrate() {
    const { data } = await notificationApi.list({ limit: 50 })
    centerItems.value = data.map(mapServerToClient)
  }
  ```
- `socket.on('notification:new')` 는 이미 있음 — 이제 서버에서 오는 payload 를 그대로 저장
- **폼 검증 warning 은 센터에 저장 안 함**: `notify.formError(msg)` 신규 헬퍼 (토스트만)
- 기존 코드 정리:
  - "이름을 입력해 주세요" 같은 검증 문구는 `formError()` 사용
  - "저장에 실패했습니다" 같은 서버 에러는 `error()` (센터 O) 유지

### 5.2 신규 화면 — 알림 설정 (`views/NotificationSettings.vue`)

```
설정 → 알림
  ┌─ 카테고리별 옵트인 ─────────────┐
  │ 센서 이상 (Critical)     ●━━ 켬  │
  │ 센서 이상 (Warning)      ●━━ 켬  │
  │ 자동제어 실패            ●━━ 켬  │
  │ 페일오버 이벤트           ●━━ 켬  │
  │ 일일 요약 리포트          ●━━ 켬  │
  │ 배터리 저 알림            ●━━ 켬  │
  └────────────────────────────────┘
  ┌─ 방해금지 시간대 ────────────────┐
  │ 사용     ●━━ 켬                  │
  │ 시작   [22:00 ▾]                 │
  │ 종료   [07:00 ▾]                 │
  │ ⚠ Critical 은 방해금지 무시하고  │
  │   즉시 전달됩니다                 │
  └────────────────────────────────┘
```

### 5.3 딥링크 표

| category | deepLink |
|---|---|
| sensor.* | `/alerts?id={alertId}` |
| gateway.* | `/gateways?highlight={gatewayId}` |
| automation.failed | `/automation?rule={ruleId}` |
| failover.* | `/emergency-failover?gateway={gatewayId}` |
| battery.* | `/alerts?type=battery` |
| system.daily_summary | `/dashboard` |

---

## 6. 기존 트리거 리팩터 (마이그레이션 순서)

### 6.1 sensor-alerts.service

`createAlertIfNotExists()` 성공 후 `NotificationService.dispatch()` 호출:
```typescript
await this.alertRepo.save(alert)
this.notificationService.dispatch({
  userId: device.userId,
  category: mapAlertToCategory(alertType, severity),   // e.g. 'sensor.no_data.critical'
  title: `${device.name} — ${SENSOR_LABEL[sensorType]}`,
  body: message,
  dedupKey: `sensor.${device.id}.${sensorType}.${alertType}`,
  deepLink: `/alerts?id=${alert.id}`,
  metadata: { alertId: alert.id, deviceId: device.id, sensorType, alertType, severity },
})
```

### 6.2 gateway-manager.service

- 자동 복구 (line 235 근처) → `gateway.auto_recovery` info dispatch (기존 activity_log 은 유지)
- 오프라인 30분 승격 로직 신규 (별도 cron 5분 마다)

### 6.3 automation-runner.service

- `broadcastAutomationExecuted` 실패 케이스에서 → `automation.failed` dispatch
- 성공 케이스는 인앱 토스트만 유지 (dispatch X)

### 6.4 fallback-config.service

- `broadcastFallbackModeChanged` 시:
  - 진입 (offline→online→offline) → `failover.entered` critical
  - 정상 복귀 (offline→online) → 별도 알림 없음 (하루 1회 요약에 포함)
- `broadcastFallbackEvent` 시:
  - opener_rain_close → `failover.rain_close_action`
  - 기타 → `failover.event`

---

## 7. Push Provider 선택

### 7.1 옵션 비교

| 옵션 | 장점 | 단점 |
|---|---|---|
| **FCM + APNs 직접 통합** | 벤더 종속 X, 무료 | 각 iOS/Android SDK, 인증서/키 관리 부담 |
| **OneSignal** | 대시보드, 무료 티어 넉넉, 세그먼트 관리 | 벤더 종속, 사용자 데이터 외부 노출 |
| **Expo Push** | Expo 앱 개발이면 원클릭, 토큰 관리 자동 | Expo 앱 이외에는 미지원 |

### 7.2 권장

- **1단계 (앱 초기)**: **Expo Push** — 모바일 앱을 Expo (React Native) 로 개발하는 전제
  - 이유: 토큰 발급 자동, 아키텍처 단순, 개발서버 즉시 테스트 가능
- **2단계 (스케일 시)**: FCM+APNs 직접 통합으로 마이그레이션 (PushProvider 인터페이스로 어댑터 교체만)

메모리에 명시된 `mobile-hybrid-app` = Capacitor 계획과도 호환:
- Capacitor 라면 `@capacitor/push-notifications` 로 FCM/APNs 토큰 획득 후 직접 통합

---

## 8. 방해금지 시간대 계산

```typescript
isInQuietHours(now: Date, startH: number, endH: number): boolean {
  const h = now.getHours()
  if (startH === endH) return false
  if (startH < endH) return h >= startH && h < endH        // 09~18 (같은 날)
  return h >= startH || h < endH                            // 22~07 (자정 넘김)
}
```

기본값: 22:00~07:00 (자정 넘김 케이스)

---

## 9. 구현 순서 (Do 체크리스트)

### Phase 1 — 인프라 (백엔드 우선, 앱 없이도 인앱 동작 확인)
- [ ] `036_notifications.sql` 마이그레이션
- [ ] `notifications` 모듈 (entity/service/controller/DTO)
- [ ] `CATEGORY_CONFIG` 매핑 표 상수
- [ ] Bull queue 등록 (Redis 이미 있음)
- [ ] `NotificationService.dispatch()` + dedup + 방해금지 로직
- [ ] 기존 트리거 리팩터 (sensor-alerts / gateway-manager / automation-runner / fallback-config)
- [ ] 프론트 `notificationApi` + store hydrate + `formError()` 헬퍼
- [ ] 프론트 `notify.warning` 검증 문구 → `formError()` 로 마이그레이션 (WorkerSettings, SpraySetup, Groups.vue 등)
- [ ] 알림 설정 화면 (`NotificationSettings.vue`) + 라우터
- [ ] vue-tsc / nest build 통과

### Phase 2 — 신규 감지 워커
- [ ] `BatteryWatchdog` cron
- [ ] `DiskWatchdog` (게이트웨이 health MQTT 페이로드 파싱)
- [ ] gateway offline 30분 승격 로직
- [ ] Zigbee 페어링 성공/실패 이벤트 → dispatch

### Phase 3 — 앱 푸시 (앱 개발 시작 시 병행)
- [ ] `PushProvider` 인터페이스 + Expo 어댑터
- [ ] `DeviceToken` 등록/해제 API + 앱 로그인 훅
- [ ] `NotificationPushProcessor` Bull worker
- [ ] 딥링크 매핑 검증

### Phase 4 — 요약 리포트
- [ ] `system.daily_summary` 매일 08:00 cron
  - 어제 관수 N회, 최고온/저온, 자동제어 실행 요약, 미해결 알림 수

---

## 10. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| 마이그레이션 후 폼 검증 문구가 여전히 센터에 쌓임 | 6.1 단계에서 `notify.formError` 로 일괄 마이그레이션 |
| 방해금지 시간대에 Critical 을 무시할 우려 | 정책적으로 Critical 은 강제 전달 — `forcePush=true` 명시 |
| dedup 로 진짜 새 사건이 묻힘 | dedupKey 를 카테고리+대상+원인 조합으로 세밀하게 (예: `sensor.deviceId.sensorType.spike`) |
| Expo 앱 아닌 웹만 사용하는 사용자 | 웹 푸시(`platform=web`) 는 향후 서비스워커 통합, 1단계는 인앱만 |
| 토큰 미갱신 → 유령 토큰 폭탄 | 앱 시작 시 토큰 갱신 + last_seen 갱신, 30일+ 미접속 토큰 자동 정리 cron |
| 사용자 옵트인 전 default가 너무 시끄러움 | Default 는 Critical/자동제어 실패/페일오버 ON, 나머지도 ON. 사용자가 필요시 OFF |

---

## 11. 데이터 보존 정책 (2026-07-20 확정)

**자동 정리 cron** — `NotificationRetentionService`
- 매일 04:00 KST 실행
- 조건: `read_at IS NOT NULL AND created_at < NOW() - INTERVAL '90 days'`
- 삭제 대상만 정리, 미읽음 알림은 무기한 보존 (사용자가 확인할 때까지)
- 실행 결과 activity_log 에 기록 (`system.notifications.pruned` — 삭제 건수)

**사용자 수동 삭제** — 알림 센터에서 개별 X 또는 전체 지우기 (이미 있음, 유지)

---

## 12. 데스크톱 브라우저 영향 정리 (2026-07-20 확인)

- **웹 푸시 미도입** — 브라우저 OS 알림(Chrome/Safari 우상단 팝업) 은 이번 개편에서 제외.
  Service Worker + VAPID 필요하나 관리 복잡도 대비 이득이 크지 않아 보류.
  향후 필요 시 별도 기획.
- **데스크톱에서도 개선되는 것**: 폼 검증 노이즈 제거, 알림 센터 영속화(hydrate),
  딥링크, 옵트인 설정 페이지 접근.
- **데스크톱 무관**: FCM/APNs/Expo 토큰, 방해금지 시간대(푸시 관련),
  iOS timeSensitive, Android heads-up.

---

## 13. Open Questions

- 앱 개발 프레임워크 확정 (Expo vs Capacitor) — 이걸 정해야 Provider 최종 선택
- 요약 리포트 발송 시각 08:00 확정? (사용자 지역/기상 브리핑과 통합 여부)
- Critical 사운드/진동 iOS "critical alert" entitlement 신청 필요 여부 검토
- ~~웹 푸시 지원 범위~~ → **미도입 확정 (2026-07-20)**

---

## 14. PDCA 다음

→ `/pdca do notification-taxonomy` — 위 9장 체크리스트 Phase 1 부터 진행
