import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { AutomationService } from '../automation/automation.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { SensorAlertsService } from '../sensor-alerts/sensor-alerts.service';
import { MidForecastService } from './mid-forecast.service';

interface AuthUser {
  id: string;
  role: string;
  parentUserId?: string | null;
}

export interface VoiceResponse {
  success: boolean;
  speech: string;
  action?: string;
  data?: any;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private usersService: UsersService,
    private devicesService: DevicesService,
    private automationService: AutomationService,
    private dashboardService: DashboardService,
    private sensorAlertsService: SensorAlertsService,
    private midForecast: MidForecastService,
  ) {}

  async execute(user: AuthUser, text: string): Promise<VoiceResponse> {
    const effectiveUserId = this.usersService.getEffectiveUserId(user);

    try {
      // 1. 사용자 농장의 모든 데이터를 수집
      const context = await this.buildContext(effectiveUserId);

      // 2. Claude Code CLI에 데이터 + 질문을 함께 전달
      const prompt = this.buildPrompt(text, context);
      const parsed = await this.askClaude(prompt);

      // 3. 실행이 필요한 액션만 처리, 나머지는 Claude 답변 그대로
      return this.executeAction(effectiveUserId, parsed);
    } catch (error) {
      this.logger.error(`음성 명령 처리 실패: ${error.message}`);
      return { success: false, speech: '명령 처리 중 오류가 발생했습니다. 다시 시도해주세요.' };
    }
  }

  private async askClaude(prompt: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = require('child_process').spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'text'], {
        timeout: 30000,
        env: { ...process.env, LANG: 'ko_KR.UTF-8' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude 종료 코드 ${code}: ${stderr.slice(0, 200)}`));
          return;
        }

        const jsonMatch = stdout.match(/```json\s*([\s\S]*?)```/) || stdout.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) {
          this.logger.warn(`Claude 응답에서 JSON을 추출할 수 없음: ${stdout.slice(0, 200)}`);
          resolve({ action: 'chat', speech: stdout.trim() });
          return;
        }

        try {
          resolve(JSON.parse(jsonMatch[1].trim()));
        } catch {
          resolve({ action: 'chat', speech: stdout.trim() });
        }
      });

      child.on('error', (err) => reject(err));

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  private buildPrompt(text: string, context: any): string {
    const deviceList = context.devices
      .map((d) => `  - ID: ${d.id} | 이름: "${d.name}" | 종류: ${d.equipmentType} | ${d.online ? '온라인' : '오프라인'}`)
      .join('\n');

    const ruleList = context.rules
      .map((r) => `  - ID: ${r.id} | 이름: "${r.name}" | ${r.enabled ? '활성' : '비활성'}`)
      .join('\n');

    const sensorInfo = context.sensorData
      ? `  온도: ${context.sensorData.temperature ?? '-'}°C, 습도: ${context.sensorData.humidity ?? '-'}%, 이슬점: ${context.sensorData.dewPoint ?? '-'}°C, 자외선: ${context.sensorData.uv ?? '-'}, 강우량: ${context.sensorData.rainfall ?? 0}mm`
      : '  (측정기 데이터 없음)';

    const logInfo = context.todayLogs.length > 0
      ? context.todayLogs.map((l) => `  - ${l.time} | ${l.ruleName} | ${l.status}`).join('\n')
      : '  (오늘 실행 이력 없음)';

    const weatherInfo = context.currentWeather
      ? `  온도: ${context.currentWeather.temperature ?? '-'}°C, 습도: ${context.currentWeather.humidity ?? '-'}%, 풍속: ${context.currentWeather.windSpeed ?? '-'}m/s, 강수: ${context.currentWeather.precipitation ?? 0}mm, 상태: ${context.currentWeather.condition}`
      : '  (외부 날씨 데이터 없음)';

    const shortForecastInfo = context.shortForecast.length > 0
      ? context.shortForecast.map((f) => {
          const parts = [`  - ${f.date}`];
          if (f.amSky && f.pmSky && f.amSky !== f.pmSky) parts.push(`오전 ${f.amSky}/오후 ${f.pmSky}`);
          else if (f.amSky) parts.push(f.amSky);
          if (f.minTemp != null && f.maxTemp != null) parts.push(`${f.minTemp}~${f.maxTemp}°C`);
          else if (f.maxTemp != null) parts.push(`최고 ${f.maxTemp}°C`);
          if (f.rainPct != null && f.rainPct > 0) parts.push(`강수확률 ${f.rainPct}%`);
          return parts.join(' | ');
        }).join('\n')
      : '  (단기예보 없음)';

    const midForecastInfo = context.midForecast.length > 0
      ? context.midForecast.map((f) => {
          const parts = [`  - ${f.day}일 후`];
          if (f.skyAm) parts.push(f.skyAm);
          if (f.minTemp != null && f.maxTemp != null) parts.push(`${f.minTemp}~${f.maxTemp}°C`);
          if (f.rainAmPct != null && f.rainAmPct > 0) parts.push(`강수확률 ${Math.max(f.rainAmPct, f.rainPmPct ?? 0)}%`);
          return parts.join(' | ');
        }).join('\n')
      : '  (중기예보 없음)';

    const alertInfo = context.recentAlerts.length > 0
      ? context.recentAlerts.map((a) => `  - ${a.time} | ${a.deviceName} | ${a.sensorType} | ${a.alertType} | ${a.severity} | ${a.message}${a.resolved ? ' (해결됨)' : ''}`).join('\n')
      : '  (최근 알림 없음)';

    const now = new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentTime = `${kstTime.getUTCFullYear()}-${String(kstTime.getUTCMonth() + 1).padStart(2, '0')}-${String(kstTime.getUTCDate()).padStart(2, '0')} ${String(kstTime.getUTCHours()).padStart(2, '0')}:${String(kstTime.getUTCMinutes()).padStart(2, '0')} KST`;

    return `너는 스마트팜 AI 어시스턴트야. 농부의 음성 명령을 해석하고, 전문적인 재배 조언도 제공해.
현재 시간: ${currentTime}
음성 인식 오류가 있을 수 있어 (예: "석문리"→"성문리"). 가장 유사한 장치를 찾아줘.

=== 사용자 농장 데이터 ===

장치 목록:
${deviceList || '  (없음)'}

자동화 룰 목록:
${ruleList || '  (없음)'}

하우스 실내 센서 (현재):
${sensorInfo}

외부 날씨 (현재):
${weatherInfo}

단기 예보 (오늘~3일 후):
${shortForecastInfo}

중기 예보 (4~10일 후):
${midForecastInfo}

최근 센서 알림:
${alertInfo}

오늘 자동화 실행 로그:
${logInfo}

=== 실행 규칙 ===

장치 제어:
- "팬 켜", "개폐기 열어" → control (장치 직접 ON/OFF)
- 개폐기 열어 = opener_open에 on, 개폐기 닫아 = opener_close에 on

관수 특별 규칙:
- 관수는 반드시 자동화 룰로만 실행. 절대 control 금지!
- "관수 돌려/실행/시작" → automation_run
- 관수 룰 1개면 바로 실행, 여러 개면 목록 보여주고 질문 (chat)

자동화:
- "룰/자동화/스케줄" 단어 있어야 자동화 관련
- "룰 실행" → automation_run, "룰 켜/꺼" → automation_toggle

자동화 룰 음성 생성:
- "매일 아침 6시에 환기 30분" 같은 요청 → create_rule
- 장치명, 시간, 동작(on/off), 반복요일을 추출해서 반환
- 정보가 부족하면 chat으로 질문해

자동화 룰 수정:
- "관수 시간을 9시로 바꿔", "환기 룰 시간 변경해줘" → update_rule
- ruleId + 변경할 필드(startTime, enabled, name 등)를 반환
- 반드시 기존 룰 목록에서 매칭되는 ruleId를 사용

다중 장치 일괄 제어:
- "전체 팬 다 꺼줘", "1동 전체 꺼", "모든 장치 꺼" → bulk_control
- deviceIds 배열 + command를 반환
- 장치 목록에서 조건에 맞는 장치들의 ID를 모두 포함
- 특정 타입만: "팬 전부 꺼" → fan 타입 장치만
- 특정 그룹만: "1동 전체 꺼" → 이름에 "1동" 포함된 장치만
- 관수는 제외! 관수는 반드시 자동화 룰로만 실행

과거형 = 이력 질문:
- "돌렸어?", "켰어?" → 오늘 로그 확인. 절대 제어 명령 아님.

=== AI 조언 역할 ===

재배 조언:
- 센서 데이터 + 날씨를 분석하여 농사 조언 제공
- "환기해야 해?", "온도가 너무 높은데 어떻게 해?" 같은 질문에 현재 데이터 기반 조언
- 이슬점, 습도, 온도를 종합하여 환기/난방/차광 추천
- 날씨 예보를 고려한 작업 일정 제안

병해충 경고:
- "잎에 반점이 생겼어", "곰팡이가 보여" 같은 증상 설명에 병해충 추정
- 현재 센서 데이터(고온다습 등)와 연관지어 가능성 높은 병해 안내
- 응급 조치 방법과 예방법 제공

센서 이상 알림 대화:
- "왜 알림 왔어?", "뭐가 문제야?" → 위의 최근 센서 알림 데이터로 원인 설명
- 어떤 센서에서 어떤 이상이 감지되었는지 쉽게 설명
- 조치 방법 추천

=== JSON 형식 (반드시 하나만, 텍스트 없이 JSON만) ===

장치 제어: {"action":"control","deviceId":"UUID","command":"on|off","speech":"응답"}
자동화 토글: {"action":"automation_toggle","ruleId":"UUID","enabled":true|false,"speech":"응답"}
자동화 즉시 실행: {"action":"automation_run","ruleId":"UUID","speech":"응답"}
자동화 룰 생성: {"action":"create_rule","name":"룰 이름","deviceType":"fan|irrigation|opener","startTime":"HH:MM","command":"on|off","daysOfWeek":[0,1,2,3,4,5,6],"duration":30,"speech":"응답"}
자동화 룰 수정: {"action":"update_rule","ruleId":"UUID","updates":{"startTime":"HH:MM"},"speech":"응답"}
다중 장치 제어: {"action":"bulk_control","deviceIds":["UUID1","UUID2"],"command":"on|off","speech":"응답"}
그 외 모든 질문/대화/조언: {"action":"chat","speech":"데이터 기반 답변"}

농부의 명령: "${text}"`;
  }

  private async executeAction(effectiveUserId: string, parsed: any): Promise<VoiceResponse> {
    switch (parsed.action) {
      case 'control':
        return this.handleControl(effectiveUserId, parsed.deviceId, parsed.command, parsed.speech);
      case 'automation_toggle':
        return this.handleAutomationToggle(effectiveUserId, parsed.ruleId, parsed.enabled);
      case 'automation_run':
        return this.handleAutomationRun(effectiveUserId, parsed.ruleId);
      case 'create_rule':
        return this.handleCreateRule(effectiveUserId, parsed);
      case 'update_rule':
        return this.handleUpdateRule(effectiveUserId, parsed);
      case 'bulk_control':
        return this.handleBulkControl(effectiveUserId, parsed);
      case 'chat':
        return { success: true, speech: parsed.speech || '무엇을 도와드릴까요?' };
      default:
        return { success: true, speech: parsed.speech || '명령을 이해하지 못했어요.' };
    }
  }

  private async handleControl(
    effectiveUserId: string,
    deviceId: string,
    command: string,
    speech?: string,
  ): Promise<VoiceResponse> {
    const devices = await this.devicesService.findAllByUser(effectiveUserId);
    const device = devices.find((d) => d.id === deviceId);

    if (!device) {
      return { success: false, speech: '해당 장치를 찾을 수 없습니다.', action: 'control' };
    }
    if (!device.online) {
      return { success: false, speech: `${device.name} 장치가 오프라인 상태입니다.`, action: 'control' };
    }

    const value = command === 'on' || command === 'open';
    try {
      // 개폐기 인터록: ON 시 반대쪽을 먼저 OFF
      const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
      if (isOpener && value && device.pairedDeviceId) {
        const pairedDevice = devices.find((d) => d.id === device.pairedDeviceId);
        if (pairedDevice && pairedDevice.online) {
          await this.devicesService.controlDevice(pairedDevice.id, effectiveUserId, [
            { code: 'switch_1', value: false },
          ]);
          this.logger.log(`개폐기 인터록: ${pairedDevice.name} OFF → 1초 대기`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      await this.devicesService.controlDevice(device.id, effectiveUserId, [
        { code: 'switch_1', value },
      ]);

      let defaultSpeech: string;
      if (isOpener) {
        defaultSpeech = device.equipmentType === 'opener_open'
          ? (value ? '개폐기를 열고 있습니다.' : '개폐기 열림을 중지했습니다.')
          : (value ? '개폐기를 닫고 있습니다.' : '개폐기 닫힘을 중지했습니다.');
      } else {
        defaultSpeech = value ? `${device.name}를 켰습니다.` : `${device.name}를 껐습니다.`;
      }
      return { success: true, speech: speech || defaultSpeech, action: 'control' };
    } catch (error) {
      return { success: false, speech: `${device.name} 제어에 실패했습니다.`, action: 'control' };
    }
  }

  private async handleAutomationToggle(effectiveUserId: string, ruleId: string, enabled: boolean): Promise<VoiceResponse> {
    try {
      const rules = await this.automationService.findAll(effectiveUserId);
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return { success: false, speech: '해당 룰을 찾을 수 없습니다.', action: 'automation_toggle' };
      const result = await this.automationService.toggle(rule.id, effectiveUserId);
      return { success: true, speech: `${rule.name} 룰을 ${result.enabled ? '활성화' : '비활성화'}했습니다.`, action: 'automation_toggle' };
    } catch {
      return { success: false, speech: '자동화 토글에 실패했습니다.', action: 'automation_toggle' };
    }
  }

  private async handleAutomationRun(effectiveUserId: string, ruleId: string): Promise<VoiceResponse> {
    try {
      const rules = await this.automationService.findAll(effectiveUserId);
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return { success: false, speech: '해당 룰을 찾을 수 없습니다.', action: 'automation_run' };

      // 현재 시간 +1분 계산 (KST)
      const nextMin = new Date(Date.now() + 60 * 1000);
      const kst = new Date(nextMin.getTime() + 9 * 60 * 60 * 1000);
      const hh = String(kst.getUTCHours()).padStart(2, '0');
      const mm = String(kst.getUTCMinutes()).padStart(2, '0');
      const newStartTime = `${hh}:${mm}`;

      const originalConditions = JSON.parse(JSON.stringify(rule.conditions || {}));
      const wasEnabled = rule.enabled;

      // 관수(irrigation) 룰: startTime만 변경
      if (originalConditions.type === 'irrigation') {
        const newConditions = { ...originalConditions, startTime: newStartTime };
        await this.automationService.update(rule.id, effectiveUserId, {
          conditions: newConditions,
          enabled: true,
        } as any);
      } else {
        // 일반 자동화: 시간 조건을 1회성으로 교체
        const h = kst.getUTCHours();
        const m = kst.getUTCMinutes();
        const origFirstCond = originalConditions?.groups?.[0]?.conditions?.[0] || {};
        const onceCondition: any = {
          field: 'hour',
          operator: 'between',
          value: [h * 100 + m, h * 100 + m + 2],
          scheduleType: 'once',
          daysOfWeek: [],
        };
        if (origFirstCond.relay) {
          onceCondition.relay = origFirstCond.relay;
          onceCondition.relayOnMinutes = origFirstCond.relayOnMinutes;
          onceCondition.relayOffMinutes = origFirstCond.relayOffMinutes;
        }
        await this.automationService.update(rule.id, effectiveUserId, {
          conditions: { ...originalConditions, groups: [{ logic: 'AND', conditions: [onceCondition] }] },
          enabled: true,
        } as any);
      }

      this.logger.log(`1회성 즉시 실행 등록: ${rule.name} → ${newStartTime}`);

      // 3분 뒤 원래 조건으로 복원
      setTimeout(async () => {
        try {
          await this.automationService.update(rule.id, effectiveUserId, {
            conditions: originalConditions,
            enabled: wasEnabled,
          } as any);
          this.logger.log(`조건 복원 완료: ${rule.name}`);
        } catch (e) {
          this.logger.error(`조건 복원 실패: ${rule.name} — ${e.message}`);
        }
      }, 180 * 1000);

      return { success: true, speech: `${rule.name} 룰을 ${newStartTime}에 실행하도록 등록했습니다. 약 1분 뒤 실행됩니다.`, action: 'automation_run' };
    } catch (error) {
      return { success: false, speech: '실행 등록에 실패했습니다.', action: 'automation_run' };
    }
  }

  private async handleCreateRule(effectiveUserId: string, parsed: any): Promise<VoiceResponse> {
    try {
      const { name, deviceType, startTime, command, daysOfWeek, duration } = parsed;
      if (!name || !startTime) {
        return { success: true, speech: parsed.speech || '룰 이름과 시작 시간을 말씀해주세요.', action: 'create_rule' };
      }

      // 장치 찾기
      const devices = await this.devicesService.findAllByUser(effectiveUserId);
      const actuators = devices.filter((d) => d.deviceType === 'actuator');
      let target = actuators.find((d) => d.equipmentType === deviceType);
      if (!target) target = actuators.find((d) => d.name.includes(deviceType));
      if (!target && actuators.length > 0) target = actuators[0];

      if (!target) {
        return { success: false, speech: '해당 장치를 찾을 수 없습니다.', action: 'create_rule' };
      }

      // 시간 파싱 → between 범위
      const [h, m] = startTime.split(':').map(Number);
      const startVal = h * 100 + m;
      const endMin = m + (duration || 30);
      const endH = h + Math.floor(endMin / 60);
      const endVal = endH * 100 + (endMin % 60);

      const payload = {
        name,
        conditions: {
          logic: 'AND',
          target: {},
          groups: [{
            logic: 'AND',
            conditions: [{
              field: 'hour',
              operator: 'between',
              value: [startVal, endVal],
              daysOfWeek: daysOfWeek || [0, 1, 2, 3, 4, 5, 6],
            }],
          }],
        },
        actions: {
          targetDeviceId: target.id,
          targetDeviceIds: [target.id],
          command: command || 'on',
          deviceType: target.equipmentType,
        },
        priority: 0,
      };

      await this.automationService.create(effectiveUserId, payload as any);
      return { success: true, speech: parsed.speech || `${name} 룰을 생성했습니다.`, action: 'create_rule' };
    } catch (error) {
      this.logger.error(`룰 생성 실패: ${error.message}`);
      return { success: false, speech: '자동화 룰 생성에 실패했습니다.', action: 'create_rule' };
    }
  }

  private async handleUpdateRule(effectiveUserId: string, parsed: any): Promise<VoiceResponse> {
    try {
      const { ruleId, updates } = parsed;
      if (!ruleId) {
        return { success: false, speech: '수정할 룰을 찾을 수 없습니다.', action: 'update_rule' };
      }

      const rules = await this.automationService.findAll(effectiveUserId);
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) {
        return { success: false, speech: '해당 룰을 찾을 수 없습니다.', action: 'update_rule' };
      }

      const updatePayload: any = {};

      // 이름 변경
      if (updates?.name) updatePayload.name = updates.name;

      // 시간 변경 (관수 룰: startTime, 일반 룰: conditions)
      if (updates?.startTime) {
        const conditions = JSON.parse(JSON.stringify(rule.conditions || {}));
        if (conditions.type === 'irrigation') {
          conditions.startTime = updates.startTime;
        } else if (conditions.groups?.[0]?.conditions?.[0]) {
          const [h, m] = updates.startTime.split(':').map(Number);
          const cond = conditions.groups[0].conditions[0];
          const duration = cond.value ? (cond.value[1] - cond.value[0]) : 100;
          cond.value = [h * 100 + m, h * 100 + m + duration];
        }
        updatePayload.conditions = conditions;
      }

      // 활성화/비활성화
      if (updates?.enabled !== undefined) updatePayload.enabled = updates.enabled;

      await this.automationService.update(rule.id, effectiveUserId, updatePayload);
      return { success: true, speech: parsed.speech || `${rule.name} 룰을 수정했습니다.`, action: 'update_rule' };
    } catch (error) {
      this.logger.error(`룰 수정 실패: ${error.message}`);
      return { success: false, speech: '룰 수정에 실패했습니다.', action: 'update_rule' };
    }
  }

  private async handleBulkControl(effectiveUserId: string, parsed: any): Promise<VoiceResponse> {
    try {
      const { deviceIds, command } = parsed;
      if (!deviceIds || deviceIds.length === 0) {
        return { success: false, speech: '제어할 장치를 찾을 수 없습니다.', action: 'bulk_control' };
      }

      const devices = await this.devicesService.findAllByUser(effectiveUserId);
      const value = command === 'on' || command === 'open';
      const results: string[] = [];
      let successCount = 0;

      for (const deviceId of deviceIds) {
        const device = devices.find((d) => d.id === deviceId);
        if (!device) continue;

        // 관수는 스킵
        if (device.equipmentType === 'irrigation') continue;

        if (!device.online) {
          results.push(`${device.name} (오프라인)`);
          continue;
        }

        try {
          // 개폐기 인터록
          const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
          if (isOpener && value && device.pairedDeviceId) {
            const paired = devices.find((d) => d.id === device.pairedDeviceId);
            if (paired?.online) {
              await this.devicesService.controlDevice(paired.id, effectiveUserId, [{ code: 'switch_1', value: false }]);
              await new Promise((r) => setTimeout(r, 1000));
            }
          }

          await this.devicesService.controlDevice(device.id, effectiveUserId, [{ code: 'switch_1', value }]);
          successCount++;
        } catch {
          results.push(`${device.name} (실패)`);
        }
      }

      const cmdLabel = value ? '켰습니다' : '껐습니다';
      const failInfo = results.length > 0 ? ` (${results.join(', ')})` : '';
      return {
        success: true,
        speech: parsed.speech || `${successCount}개 장치를 ${cmdLabel}.${failInfo}`,
        action: 'bulk_control',
      };
    } catch (error) {
      this.logger.error(`일괄 제어 실패: ${error.message}`);
      return { success: false, speech: '일괄 제어에 실패했습니다.', action: 'bulk_control' };
    }
  }

  private async buildContext(effectiveUserId: string) {
    const user = await this.usersService.findOne(effectiveUserId);

    const [devices, rules, widgetData, logsResult, weatherData, shortForecast, midForecast, alertsResult] = await Promise.all([
      this.devicesService.findAllByUser(effectiveUserId),
      this.automationService.findAll(effectiveUserId),
      this.dashboardService.getWidgetData(effectiveUserId).catch(() => null),
      this.automationService.getLogs(effectiveUserId, { page: 1, limit: 20 }).catch(() => ({ data: [] })),
      user?.address ? this.dashboardService.getWeatherForUser(effectiveUserId).catch(() => null) : null,
      user?.address ? this.midForecast.getShortForecast(user.address).catch(() => ({ data: null })) : { data: null },
      user?.address ? this.midForecast.getMidForecast(user.address).catch(() => ({ data: null })) : { data: null },
      this.sensorAlertsService.findAll(effectiveUserId, { limit: 10 }).catch(() => ({ data: [], total: 0 })),
    ]);

    // 오늘 로그만 필터
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = (logsResult.data || [])
      .filter((l: any) => new Date(l.executedAt) >= today)
      .map((l: any) => ({
        time: new Date(l.executedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        ruleName: l.ruleName || '(알 수 없음)',
        status: l.conditionsMet?.type || l.status || 'executed',
      }));

    // 중기예보에서 데이터 있는 날만
    const midForecasts = (midForecast.data?.forecasts || []).filter(
      (f: any) => f.skyAm || f.minTemp != null,
    );

    // 최근 알림 가공
    const recentAlerts = (alertsResult.data || []).slice(0, 10).map((a: any) => ({
      time: new Date(a.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      deviceName: a.deviceName || '(알 수 없음)',
      sensorType: a.sensorType,
      alertType: a.alertType,
      severity: a.severity,
      message: a.message,
      resolved: a.resolved,
    }));

    return {
      devices: devices
        .filter((d) => d.deviceType === 'actuator')
        .map((d) => ({ id: d.id, name: d.name, equipmentType: d.equipmentType || 'other', online: d.online })),
      rules: rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })),
      sensorData: widgetData?.inside || null,
      currentWeather: weatherData?.weather || null,
      shortForecast: shortForecast.data || [],
      midForecast: midForecasts,
      todayLogs,
      recentAlerts,
    };
  }
}
