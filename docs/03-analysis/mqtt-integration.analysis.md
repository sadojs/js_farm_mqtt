# MQTT Integration Gap Analysis

> Design vs Implementation 비교 분석 (2026-03-25)

## Overall Match Rate: 90%

| Category | Score |
|----------|:-----:|
| Backend MqttModule | 95% |
| Backend GatewayManager | 80% |
| Backend Devices/Automation | 100% |
| DB Schema | 92% |
| Frontend | 90% |
| Raspberry Pi | 100% |
| **Overall** | **90%** |

## Missing (High Priority)

| # | Item | Issue |
|---|------|-------|
| 1 | `GET /gateways/:id/zigbee-devices` | Controller 엔드포인트 미구현. MqttService 로직은 있으나 REST API 미노출 |
| 2 | `POST /gateways/:id/permit-join` | Controller 엔드포인트 미구현. MqttService 로직은 있으나 REST API 미노출 |
| 3 | MqttSensorHandler/DeviceHandler 장비 조회에 gateway_id 조건 누락 | 다중 게이트웨이 환경에서 동일 friendly_name 충돌 가능 |

## Partial (Medium/Low)

| # | Item | Issue |
|---|------|-------|
| 4 | schema.sql tuya_projects 트리거 잔존 | 삭제된 테이블의 코드가 남아있음 |
| 5 | temperature/humidity.sensor.ts Tuya 주석 잔존 | Low |
| 6 | Devices.vue 게이트웨이 필터 UI | 설계서 명시, 미구현 |

## Added (설계서에 없는 구현)

- MQTT 인증 지원 (MQTT_USERNAME/PASSWORD)
- illuminance 센서 키 추가
- Coordinator 노드 필터링
- sensor-collector.service.ts 하위호환 유지
