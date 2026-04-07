import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { AutomationService } from '../automation/automation.service';
import { DashboardService } from '../dashboard/dashboard.service';
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
    private midForecast: MidForecastService,
  ) {}

  async execute(user: AuthUser, text: string): Promise<VoiceResponse> {
    const effectiveUserId = this.usersService.getEffectiveUserId(user);

    try {
      // 1. 사용자 농장 컨텍스트 구성
      const context = await this.buildContext(effectiveUserId);

      // 2. Claude Code CLI로 해석 요청
      const prompt = this.buildPrompt(text, context);
      const parsed = await this.askClaude(prompt);

      // 3. 해석 결과로 명령 실행
      return this.executeAction(effectiveUserId, parsed);
    } catch (error) {
      this.logger.error(`음성 명령 처리 실패: ${error.message}`);
      return { success: false, speech: '명령 처리 중 오류가 발생했습니다. 다시 시도해주세요.' };
    }
  }

  private async askClaude(prompt: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = require('child_process').spawn('claude', ['-p', '--output-format', 'text'], {
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

        // JSON 블록 추출
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

      // stdin으로 프롬프트 전달
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

    // 실내 센서 현재값
    const s = context.sensorData;
    const sensorInfo = s
      ? `  온도: ${s.temperature ?? '-'}°C, 습도: ${s.humidity ?? '-'}%, 이슬점: ${s.dewPoint ?? '-'}°C, 자외선: ${s.uv ?? '-'}, 강우량: ${s.rainfall ?? 0}mm`
      : '  (측정기 데이터 없음)';

    // 오늘 실행 로그
    const logInfo = context.todayLogs.length > 0
      ? context.todayLogs.map((l) => `  - ${l.time} | ${l.ruleName} | ${l.status}`).join('\n')
      : '  (오늘 실행 이력 없음)';

    return `너는 스마트팜 음성 어시스턴트야. 농부의 음성 명령을 해석해서 정확한 JSON 액션을 반환해.

음성 인식 오류가 있을 수 있어. 예: "석문리"가 "성문리", "성문lee" 등으로 인식될 수 있으니 가장 유사한 장치를 찾아줘.

장치 목록:
${deviceList || '  (없음)'}

자동화 룰 목록:
${ruleList || '  (없음)'}

현재 하우스 실내 센서:
${sensorInfo}

오늘 자동화 실행 로그:
${logInfo}

중요: 장치 직접 제어 vs 자동화 룰은 완전히 다른 것이야!

관수(irrigation) 특별 규칙:
- 관수는 반드시 자동화 룰로만 동작함. 절대 control로 직접 제어하지 마!
- "관수 돌려", "관수 실행해", "관수 시작", "관수 한번 돌려", "관수 실행시켜" → 반드시 automation_run JSON을 반환해
- "한번더", "다시", "지금" 등의 부사가 붙어도 동일하게 automation_run으로 처리
- 관수 관련 자동화 룰이 1개면 해당 ruleId로 automation_run 반환
- 관수 관련 룰이 여러 개면 chat으로 "관수 룰이 N개 있습니다: A, B. 어떤 걸 실행할까요?" 반환
- 관수 관련 룰이 0개면 chat으로 "관수 자동화 룰이 없습니다" 반환
- "관수 룰 켜줘/꺼줘" → automation_toggle (활성화/비활성화)

팬/개폐기 등 일반 장치:
- "팬 켜", "개폐기 열어" → 장치 직접 제어 (control)
- "팬 룰 켜줘" → automation_toggle

과거형 = 이력 질문:
- "관수 돌렸어?", "팬 켰어?", "오늘 관수 했어?" → 오늘 실행 로그를 확인해서 답변 (chat)
- 과거형은 절대 장치 제어(control)나 automation_run으로 해석하지 마

장치 제어 규칙:
- 개폐기 열어 = opener_open 장치에 command: "on"
- 개폐기 닫아 = opener_close 장치에 command: "on"
- 팬/관수 등: on=켜기, off=끄기
- 인터록은 서버에서 자동 처리하니 단순히 on/off만 보내면 됨

자동화 규칙:
- "룰 실행해", "자동화 당장 실행" → automation_run (즉시 실행)
- "룰 켜줘", "자동화 켜/꺼" → automation_toggle (활성화/비활성화)
- 반드시 "룰", "자동화", "스케줄" 단어가 포함되어야 자동화 관련으로 처리

날씨/환경 규칙:
- 실내 온도, 하우스 환경, 습도 등 질문 → 위의 센서 데이터로 직접 답변 (chat 사용)
- "지금 날씨", "밖에 날씨" → weather (외부 기상)
- "오늘 날씨" → short_forecast, days: ["오늘"]만
- "내일 날씨" → short_forecast, days: ["내일"]만
- "모레 비 와?" → short_forecast, days: ["모레"]만
- "내일 모레 날씨" → short_forecast, days: ["내일", "모레"]
- "3일간 날씨" → short_forecast, days: ["오늘", "내일", "모레"]
- "이번주 날씨", "다음주", "주간 예보" → forecast (중기예보, 4~10일)
- 묻는 날짜만 답변해. 오늘 날씨를 물어봤으면 오늘만, 내일만 물어봤으면 내일만 답변해

반드시 아래 JSON 형식 중 하나로만 응답해. 다른 텍스트 없이 JSON만 출력해:

장치 제어: {"action":"control","deviceId":"UUID","command":"on|off","speech":"응답 메시지"}
현재 날씨(외부): {"action":"weather","speech":""}
단기 예보: {"action":"short_forecast","days":["오늘"],"speech":""}
중기 예보(4~10일): {"action":"forecast","speech":""}
장치 상태: {"action":"device_status","speech":""}
자동화 목록: {"action":"automation_list","speech":""}
자동화 토글: {"action":"automation_toggle","ruleId":"UUID","enabled":true|false,"speech":"응답 메시지"}
자동화 즉시 실행: {"action":"automation_run","ruleId":"UUID","speech":"응답 메시지"}
일반 대화/센서 질문: {"action":"chat","speech":"센서 데이터를 활용한 답변"}

농부의 명령: "${text}"`;
  }

  private async executeAction(effectiveUserId: string, parsed: any): Promise<VoiceResponse> {
    switch (parsed.action) {
      case 'control':
        return this.handleControl(effectiveUserId, parsed.deviceId, parsed.command, parsed.speech);
      case 'weather':
        return this.handleWeather(effectiveUserId);
      case 'short_forecast':
        return this.handleShortForecast(effectiveUserId, parsed.days);
      case 'forecast':
        return this.handleForecast(effectiveUserId);
      case 'device_status':
        return this.handleDeviceStatus(effectiveUserId);
      case 'automation_list':
        return this.handleAutomationList(effectiveUserId);
      case 'automation_toggle':
        return this.handleAutomationToggle(effectiveUserId, parsed.ruleId, parsed.enabled);
      case 'automation_run':
        return this.handleAutomationRun(effectiveUserId, parsed.ruleId);
      case 'chat':
        return { success: true, speech: parsed.speech || '무엇을 도와드릴까요?' };
      default:
        return { success: false, speech: parsed.speech || '명령을 이해하지 못했어요.' };
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

  private async handleWeather(effectiveUserId: string): Promise<VoiceResponse> {
    try {
      const data = await this.dashboardService.getWeatherForUser(effectiveUserId);
      if (!data.weather) {
        return { success: false, speech: '날씨 정보를 가져올 수 없습니다.', action: 'weather' };
      }
      const w = data.weather;
      const loc = data.location?.level2 || '';
      const speech = `현재 ${loc} 날씨입니다. 온도 ${w.temperature ?? '-'}도, 습도 ${w.humidity ?? '-'}%, 풍속 ${w.windSpeed ?? '-'}미터입니다.${w.precipitation > 0 ? ` 강수량 ${w.precipitation}밀리미터입니다.` : ''}`;
      return { success: true, speech, action: 'weather', data: w };
    } catch {
      return { success: false, speech: '날씨 정보를 가져올 수 없습니다.', action: 'weather' };
    }
  }

  private async handleShortForecast(effectiveUserId: string, days?: string[]): Promise<VoiceResponse> {
    try {
      const user = await this.usersService.findOne(effectiveUserId);
      if (!user?.address) {
        return { success: false, speech: '주소가 설정되어 있지 않아 예보를 조회할 수 없습니다.', action: 'short_forecast' };
      }
      const result = await this.midForecast.getShortForecast(user.address);
      if (!result.data) {
        return { success: false, speech: result.speech, action: 'short_forecast' };
      }

      // 요청한 날짜만 필터링
      let filtered = result.data;
      if (days && days.length > 0) {
        filtered = result.data.filter((f) => days.includes(f.date));
      }

      if (filtered.length === 0) {
        return { success: false, speech: '해당 날짜의 예보 데이터가 없습니다.', action: 'short_forecast' };
      }

      // 필터된 결과로 음성 응답 생성
      const lines: string[] = [];
      for (const f of filtered) {
        const parts: string[] = [f.date];
        if (f.amSky && f.pmSky && f.amSky !== f.pmSky) {
          parts.push(`오전 ${f.amSky}, 오후 ${f.pmSky}`);
        } else if (f.amSky || f.pmSky) {
          parts.push(f.amSky || f.pmSky!);
        }
        if (f.minTemp != null && f.maxTemp != null) {
          parts.push(`${f.minTemp}도에서 ${f.maxTemp}도`);
        } else if (f.maxTemp != null) {
          parts.push(`최고 ${f.maxTemp}도`);
        }
        if (f.rainPct != null && f.rainPct > 0) {
          parts.push(`강수확률 ${f.rainPct}%`);
        }
        lines.push(parts.join(', '));
      }

      return { success: true, speech: lines.join('. '), action: 'short_forecast', data: filtered };
    } catch {
      return { success: false, speech: '단기 예보를 가져올 수 없습니다.', action: 'short_forecast' };
    }
  }

  private async handleForecast(effectiveUserId: string): Promise<VoiceResponse> {
    try {
      const user = await this.usersService.findOne(effectiveUserId);
      if (!user?.address) {
        return { success: false, speech: '주소가 설정되어 있지 않아 예보를 조회할 수 없습니다.', action: 'forecast' };
      }
      const result = await this.midForecast.getMidForecast(user.address);
      return { success: !!result.data, speech: result.speech, action: 'forecast', data: result.data };
    } catch {
      return { success: false, speech: '중기 예보를 가져올 수 없습니다.', action: 'forecast' };
    }
  }

  private async handleDeviceStatus(effectiveUserId: string): Promise<VoiceResponse> {
    const devices = await this.devicesService.findAllByUser(effectiveUserId);
    const actuators = devices.filter((d) => d.deviceType === 'actuator');
    if (actuators.length === 0) {
      return { success: true, speech: '등록된 장치가 없습니다.', action: 'device_status' };
    }
    const online = actuators.filter((d) => d.online);
    const offline = actuators.filter((d) => !d.online);
    const parts: string[] = [`총 ${actuators.length}개 장치.`];
    if (online.length > 0) parts.push(`온라인: ${online.map((d) => d.name).join(', ')}`);
    if (offline.length > 0) parts.push(`오프라인 ${offline.length}개`);
    return { success: true, speech: parts.join(' '), action: 'device_status' };
  }

  private async handleAutomationList(effectiveUserId: string): Promise<VoiceResponse> {
    const rules = await this.automationService.findAll(effectiveUserId);
    if (rules.length === 0) {
      return { success: true, speech: '등록된 자동화 룰이 없습니다.', action: 'automation_list' };
    }
    const parts = rules.map((r) => `${r.name} ${r.enabled ? '활성' : '비활성'}`);
    return { success: true, speech: `자동화 룰 ${rules.length}개: ${parts.join(', ')}`, action: 'automation_list' };
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

  private async buildContext(effectiveUserId: string) {
    const [devices, rules, widgetData, logsResult] = await Promise.all([
      this.devicesService.findAllByUser(effectiveUserId),
      this.automationService.findAll(effectiveUserId),
      this.dashboardService.getWidgetData(effectiveUserId).catch(() => null),
      this.automationService.getLogs(effectiveUserId, { page: 1, limit: 20 }).catch(() => ({ data: [] })),
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

    return {
      devices: devices
        .filter((d) => d.deviceType === 'actuator')
        .map((d) => ({ id: d.id, name: d.name, equipmentType: d.equipmentType || 'other', online: d.online })),
      rules: rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })),
      sensorData: widgetData?.inside || null,
      todayLogs,
    };
  }
}
