import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { DevicesService } from '../devices/devices.service';
import { AutomationService } from '../automation/automation.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { SensorAlertsService } from '../sensor-alerts/sensor-alerts.service';
import { SprayScheduleService } from '../spray-schedule/spray-schedule.service';
import { WorkLogService } from '../work-log/work-log.service';
import { GroupsService } from '../groups/groups.service';
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
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    private usersService: UsersService,
    private devicesService: DevicesService,
    private automationService: AutomationService,
    private dashboardService: DashboardService,
    private sensorAlertsService: SensorAlertsService,
    private sprayScheduleService: SprayScheduleService,
    private workLogService: WorkLogService,
    private groupsService: GroupsService,
    private midForecast: MidForecastService,
  ) {}

  async execute(user: AuthUser, text: string): Promise<VoiceResponse> {
    const effectiveUserId = this.usersService.getEffectiveUserId(user);

    try {
      // 1. 사용자 농장의 모든 데이터를 수집
      const context = await this.buildContext(effectiveUserId);

      // 2. Claude Code CLI에 데이터 + 질문을 함께 전달 (재시도 1회)
      const prompt = this.buildPrompt(text, context);
      let parsed: any;
      try {
        parsed = await this.askClaude(prompt);
      } catch (firstError) {
        // 시간 초과(종료 코드 null = 타임아웃으로 kill)는 재시도해도 또 느려 응답만 늦어지므로 바로 실패 처리
        if (/종료 코드 null/.test(firstError.message)) throw firstError;
        this.logger.warn(`Claude 1차 호출 실패, 재시도: ${firstError.message}`);
        parsed = await this.askClaude(prompt);
      }

      // 3. 실행이 필요한 액션만 처리
      const result = await this.executeAction(effectiveUserId, parsed, user?.role);

      // 4. 장치 제어 성공 시 별칭 학습
      if (result.success && parsed.action === 'control' && parsed.deviceId) {
        await this.learnAlias(effectiveUserId, text, parsed.deviceId);
      }

      return result;
    } catch (error) {
      this.logger.error(`음성 명령 처리 실패: ${error.message}`);
      return { success: false, speech: '명령 처리 중 오류가 발생했습니다. 다시 시도해주세요.' };
    }
  }

  /** 장치 제어 성공 시 음성 텍스트에서 장치명 부분을 별칭으로 저장 */
  private async learnAlias(effectiveUserId: string, rawText: string, deviceId: string): Promise<void> {
    try {
      const devices = await this.devicesService.findAllByUser(effectiveUserId);
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;

      // 정확한 장치명이 이미 포함되어 있으면 학습 불필요
      if (rawText.includes(device.name)) return;

      // 명령 키워드 제거 → 남은 부분이 사용자가 말한 장치명
      const removeWords = ['켜줘', '꺼줘', '켜', '꺼', '열어', '닫아', '시작', '중지', '돌려', '틀어',
        '좀', '해줘', '줘', '주세요', '를', '을', '에', '지금', '다시', '한번'];
      let alias = rawText;
      for (const w of removeWords) alias = alias.replace(new RegExp(w, 'g'), '');
      alias = alias.replace(/\s+/g, ' ').trim();

      if (!alias || alias.length < 2 || alias === device.name) return;

      // 기존 별칭과 동일하면 스킵
      const userRecord = await this.usersRepo.findOne({ where: { id: effectiveUserId } });
      if (!userRecord) return;
      const aliases = userRecord.voiceAliases || {};
      if (aliases[alias] === device.name) return;

      // 별칭 저장 (최대 50개, 오래된 것 제거)
      aliases[alias] = device.name;
      const keys = Object.keys(aliases);
      if (keys.length > 50) {
        delete aliases[keys[0]];
      }
      userRecord.voiceAliases = aliases;
      await this.usersRepo.save(userRecord);
      this.logger.log(`별칭 학습: "${alias}" → "${device.name}" (userId: ${effectiveUserId})`);
    } catch {
      // 학습 실패는 무시
    }
  }

  private async askClaude(prompt: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // claude CLI 인증은 프로젝트 디렉터리 기준이라 cwd 를 바꾸면 'Not logged in' 이 되므로
      // 프로젝트 cwd 에서 실행한다. 단, 프로젝트 .claude/settings.local.json 에 잘못된 권한 규칙이
      // 누적되면 claude 가 시작 시 종료코드 1 로 죽으니 해당 파일을 깨끗하게 유지해야 한다.
      const child = require('child_process').spawn(
        'claude',
        ['-p', '--model', 'sonnet', '--output-format', 'text'],
        {
          // CLI 기동만 ~10초 + 컨텍스트 포함 응답이 보통 20~25초라 30초는 경계값 → 여유 있게 50초
          timeout: 50000,
          // 확장 사고(thinking)는 명령 파싱에 불필요하고 지연만 늘리므로 끈다
          env: { ...process.env, LANG: 'ko_KR.UTF-8', MAX_THINKING_TOKENS: '0' },
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude 종료 코드 ${code}: ${(stderr || stdout).slice(0, 250)}`));
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

    const sprayInfo = (context.spraySchedule || []).length > 0
      ? context.spraySchedule.map((s: any) => {
          if (s.kind === 'bee_open') return `  - ${s.date} | ${s.zoneName ?? '-'} | 🐝 벌문 개방`;
          const tod = s.timeOfDay === 'am' ? '오전' : s.timeOfDay === 'pm' ? '오후' : '';
          return `  - ${s.date} | ${s.zoneName ?? '-'} | ${s.pest ?? ''}${s.round ? ' ' + s.round + '차' : ''}${tod ? ' (' + tod + ')' : ''}${s.product ? ' | ' + s.product : ''}`;
        }).join('\n')
      : '  (오늘~7일 내 방재일정 없음)';

    const workInfo = (context.workBoard || []).length > 0
      ? context.workBoard.map((w: any) => `  - ${w.task} | ${w.zoneName} | ${w.elapsedDays}일 전 (마지막 ${w.lastDoneAt})`).join('\n')
      : '  (농작업 기록 없음)';

    const protectionInfo = (context.protectionHouses || []).length > 0
      ? context.protectionHouses.map((h: any) =>
          `  - ID: ${h.id} | 이름: "${h.name}" | 개폐기 ${h.hasOpeners ? '있음' : '없음'} | 유동팬 ${h.hasFans ? '있음' : '없음'} | ${h.active ? `방재 중 (남은 ${h.remainingMinutes}분)` : '대기'}`,
        ).join('\n')
      : '  (방재 가능한 하우스 없음)';

    const now = new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentTime = `${kstTime.getUTCFullYear()}-${String(kstTime.getUTCMonth() + 1).padStart(2, '0')}-${String(kstTime.getUTCDate()).padStart(2, '0')} ${String(kstTime.getUTCHours()).padStart(2, '0')}:${String(kstTime.getUTCMinutes()).padStart(2, '0')} KST`;

    return `너는 스마트팜 AI 어시스턴트야. 농부의 음성 명령을 해석하고, 전문적인 재배 조언도 제공해.
현재 시간: ${currentTime}
음성 인식 오류가 있을 수 있어 (예: "석문리"→"성문리"). 가장 유사한 장치를 찾아줘.
${context.aliases ? `\n학습된 별칭 (이전에 매칭 성공한 발음→장치명):\n${context.aliases}\n` : ''}
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

방재일정 (오늘~7일, 약품/벌문 개방):
${sprayInfo}

농작업 상태 (구역별 작업 마지막 경과일, 오래된 순):
${workInfo}

방재 모드 대상 하우스 (개폐기 닫기·유동팬 정지 밀폐 타이머):
${protectionInfo}

=== 실행 규칙 ===

방재 모드 (하우스 밀폐 타이머 — 위 '방재일정'(약품 살포 일정)과 다른 기능):
- 하우스 이름 + 시간과 함께 방재를 "해줘/돌려/시작/켜/동작시켜" → protection_start
  예: "하교하우스 방재 1시간 동작시켜줘" → groupId=하교하우스 ID, durationMinutes=60
- 시간은 분으로 환산 (1시간=60, 30분=30, 1시간 반=90, 2시간=120). 허용 범위 1~720분(12시간), 벗어나면 chat으로 안내
- 시간을 말하지 않았으면 실행하지 말고 chat으로 "몇 시간 동안 할까요?"라고 질문
- 하우스는 반드시 '방재 모드 대상 하우스' 목록의 ID만 사용. 특정이 안 되거나 애매하면 chat으로 질문
- 기본은 개폐기 닫기 + 유동팬 정지 둘 다. "개폐기만" → stopFans:false, "팬만/유동팬만" → closeOpeners:false
- "방재 연장", "30분 더" → protection_extend (addMinutes 기본 30)
- "방재 꺼/중지/정지/그만/해제" → protection_stop
- "방재 중이야?", "방재 얼마 남았어?" → 위 상태로 chat 답변
- "오늘 방재 있어?", "방재 언제야?"처럼 일정을 묻는 건 방재일정 chat 답변 (방재 모드 아님)

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

방재일정 질문 (위 '방재일정' 데이터로 chat 답변):
- "오늘 방재 있어?", "이번주 방재 언제야?", "벌문 언제 열어?" → 날짜·구역·약품을 알려줌
- 데이터에 없으면 "예정된 방재일정이 없다"고 답해

농작업 질문 (위 '농작업 상태' 데이터로 chat 답변):
- "순지르기(하엽 제거 등) 가장 오래된 구역 어디야?", "어느 구역이 작업한 지 제일 오래됐어?"
  → 해당 작업의 경과일이 가장 큰 구역을 알려줌 (목록은 오래된 순 정렬됨)
- "현호하우스 마지막 점검 언제야?" → 그 구역·작업의 경과일/날짜로 답
- 전부 chat 액션으로만 답한다(이 기능들은 제어/생성 액션 없음).

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
방재 시작: {"action":"protection_start","groupId":"UUID","durationMinutes":60,"closeOpeners":true,"stopFans":true,"speech":"응답"}
방재 연장: {"action":"protection_extend","groupId":"UUID","addMinutes":30,"speech":"응답"}
방재 해제: {"action":"protection_stop","groupId":"UUID","speech":"응답"}
그 외 모든 질문/대화/조언: {"action":"chat","speech":"데이터 기반 답변"}

농부의 명령: "${text}"`;
  }

  private async executeAction(effectiveUserId: string, parsed: any, role?: string): Promise<VoiceResponse> {
    switch (parsed.action) {
      case 'protection_start':
        return this.handleProtectionStart(effectiveUserId, parsed, role);
      case 'protection_extend':
        return this.handleProtectionExtend(effectiveUserId, parsed, role);
      case 'protection_stop':
        return this.handleProtectionStop(effectiveUserId, parsed, role);
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

  // ── 방재 모드 (하우스 밀폐 타이머) ──
  // 응답 문구는 LLM speech 가 아니라 실제 처리 결과로 만든다(실패를 성공처럼 말하지 않도록).

  private kstHm(iso: string): string {
    const k = new Date(new Date(iso).getTime() + 9 * 3600000);
    const h = k.getUTCHours();
    const m = k.getUTCMinutes();
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
  }

  private fmtMinutes(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return [h ? `${h}시간` : '', m ? `${m}분` : ''].filter(Boolean).join(' ') || '0분';
  }

  private protectionError(e: any, fallback: string): string {
    const msg = e?.response?.message || e?.message;
    if (e?.status === 404 || /찾을 수 없/.test(msg || '')) return '해당 하우스를 찾을 수 없어요.';
    return typeof msg === 'string' && /[가-힣]/.test(msg) ? msg : fallback;
  }

  private async houseName(effectiveUserId: string, groupId: string): Promise<string> {
    const groups = await this.groupsService.findAllGroups(effectiveUserId).catch(() => [] as any[]);
    return (groups || []).find((g: any) => g.id === groupId)?.name || '하우스';
  }

  private async handleProtectionStart(effectiveUserId: string, parsed: any, role?: string): Promise<VoiceResponse> {
    const action = 'protection_start';
    if (role === 'farm_user') return { success: false, speech: '방재 모드는 관리자만 실행할 수 있어요.', action };
    if (!parsed.groupId) return { success: true, speech: parsed.speech || '어느 하우스를 방재할까요?', action };
    const minutes = Math.round(Number(parsed.durationMinutes));
    if (!minutes) return { success: true, speech: parsed.speech || '몇 시간 동안 방재할까요?', action };
    try {
      const name = await this.houseName(effectiveUserId, parsed.groupId);
      const r = await this.groupsService.startProtection(parsed.groupId, effectiveUserId, {
        durationMinutes: minutes,
        closeOpeners: parsed.closeOpeners !== false,
        stopFans: parsed.stopFans !== false,
      });
      const { openers, fans } = r.applied;
      if (!openers && !fans) {
        return { success: false, speech: `${name}에는 방재로 제어할 개폐기나 유동팬이 없어요.`, action };
      }
      const parts = [openers ? `개폐기 ${openers}개 닫기` : '', fans ? `유동팬 ${fans}개 정지` : ''].filter(Boolean);
      return {
        success: true,
        speech: `${name} 방재를 ${this.fmtMinutes(minutes)} 동안 시작했어요. ${parts.join(', ')}. ${this.kstHm(r.until)}에 자동으로 해제되고, 그동안 자동제어는 멈춥니다.`,
        action,
        data: { groupId: parsed.groupId, until: r.until },
      };
    } catch (e: any) {
      return { success: false, speech: this.protectionError(e, '방재 시작에 실패했어요.'), action };
    }
  }

  private async handleProtectionExtend(effectiveUserId: string, parsed: any, role?: string): Promise<VoiceResponse> {
    const action = 'protection_extend';
    if (role === 'farm_user') return { success: false, speech: '방재 모드는 관리자만 실행할 수 있어요.', action };
    if (!parsed.groupId) return { success: true, speech: parsed.speech || '어느 하우스의 방재를 연장할까요?', action };
    const add = Math.round(Number(parsed.addMinutes)) || 30;
    try {
      const name = await this.houseName(effectiveUserId, parsed.groupId);
      const r = await this.groupsService.extendProtection(parsed.groupId, effectiveUserId, { addMinutes: add });
      return {
        success: true,
        speech: `${name} 방재를 ${this.fmtMinutes(add)} 연장했어요. ${this.kstHm(r.until)}에 해제됩니다.`,
        action,
        data: { groupId: parsed.groupId, until: r.until },
      };
    } catch (e: any) {
      return { success: false, speech: this.protectionError(e, '방재 연장에 실패했어요.'), action };
    }
  }

  private async handleProtectionStop(effectiveUserId: string, parsed: any, role?: string): Promise<VoiceResponse> {
    const action = 'protection_stop';
    if (role === 'farm_user') return { success: false, speech: '방재 모드는 관리자만 실행할 수 있어요.', action };
    if (!parsed.groupId) return { success: true, speech: parsed.speech || '어느 하우스의 방재를 해제할까요?', action };
    try {
      const name = await this.houseName(effectiveUserId, parsed.groupId);
      const r = await this.groupsService.cancelProtection(parsed.groupId, effectiveUserId);
      if (!r.cancelled) return { success: true, speech: `${name}은 진행 중인 방재가 없어요.`, action };
      return { success: true, speech: `${name} 방재를 해제했어요. 자동제어가 다시 동작합니다.`, action };
    } catch (e: any) {
      return { success: false, speech: this.protectionError(e, '방재 해제에 실패했어요.'), action };
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
    const isOpener = device.equipmentType === 'opener_open' || device.equipmentType === 'opener_close';
    try {
      // 개폐기 수동 조작은 앱 버튼과 동일하게 먼저 이 개폐기의 활성 룰을 정지 — 안 하면 다음 주기에 룰이 반대로 움직임
      if (isOpener) {
        await this.automationService.stopActiveRulesForDevice(effectiveUserId, device.id).catch(() => undefined);
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

      // 룰 조건을 바꾸지 않고 즉시 1회 실행 (이전: 조건을 임시 교체 후 3분 뒤 메모리 타이머로 복원 →
      // 그 사이 서버가 재시작되면 원래 조건이 영구 소실되던 문제)
      await this.automationService.runRuleNow(rule.id, effectiveUserId);
      this.logger.log(`음성 즉시 실행: ${rule.name}`);
      return { success: true, speech: `${rule.name} 룰을 지금 실행했습니다.`, action: 'automation_run' };
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

    // ── 방재일정(spray) + 농작업 상태(work board) 수집 (KST 기준) ──
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const ymd = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const todayKst = ymd(kstNow);
    const weekKst = ymd(new Date(kstNow.getTime() + 7 * 86400000));
    const kstDayNum = (iso: string) => {
      const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
      return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
    };
    const todayDayNum = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());

    const workUser = { id: effectiveUserId, role: 'admin' as const };
    const [sprayRaw, boardRows, taskTypes, groups] = await Promise.all([
      this.sprayScheduleService.getEvents(effectiveUserId, todayKst, weekKst).catch(() => [] as any[]),
      this.workLogService.boardMatrix(workUser).catch(() => [] as any[]),
      this.workLogService.listTaskTypes(workUser).catch(() => [] as any[]),
      this.groupsService.findAllGroups(effectiveUserId).catch(() => [] as any[]),
    ]);

    const spraySchedule = (sprayRaw || []).map((e: any) => ({
      date: e.date,
      zoneName: e.zoneName,
      pest: e.pest,
      product: e.product,
      kind: e.kind, // 'spray' | 'bee_open'
      round: e.round,
      timeOfDay: e.timeOfDay, // 'am' | 'pm'
    }));

    const taskMap: Record<string, string> = Object.fromEntries(
      (taskTypes || []).map((t: any) => [t.id, t.label]),
    );
    const zoneMap: Record<string, string> = Object.fromEntries(
      (groups || []).map((g: any) => [g.id, g.name]),
    );
    const workBoard = (boardRows || [])
      .map((r: any) => ({
        zoneName: zoneMap[r.zoneId] || '(구역)',
        task: taskMap[r.taskTypeId] || '(작업)',
        lastDoneAt: (r.lastDoneAt || '').slice(0, 10),
        elapsedDays: Math.max(0, Math.round((todayDayNum - kstDayNum(r.lastDoneAt)) / 86400000)),
      }))
      .sort((a, b) => b.elapsedDays - a.elapsedDays); // 오래된 작업 먼저

    // 방재 모드 대상 하우스: 개폐기/유동팬이 있는 구역만 + 현재 방재 상태
    const protectionHouses = (await Promise.all(
      (groups || []).map(async (g: any) => {
        const acts = (g.devices || []).filter((d: any) => d.deviceType === 'actuator');
        const hasOpeners = acts.some((d: any) => d.equipmentType === 'opener_open' || d.equipmentType === 'opener_close');
        const hasFans = acts.some((d: any) => d.equipmentType === 'fan');
        if (!hasOpeners && !hasFans) return null;
        const st: any = await this.groupsService.getProtection(g.id, effectiveUserId).catch(() => ({ active: false }));
        return { id: g.id, name: g.name, hasOpeners, hasFans, active: !!st.active, remainingMinutes: st.remainingMinutes ?? null };
      }),
    )).filter(Boolean);

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
      spraySchedule,
      workBoard,
      protectionHouses,
      aliases: this.formatAliases(user?.voiceAliases),
    };
  }

  private formatAliases(voiceAliases: Record<string, string> | undefined): string {
    if (!voiceAliases) return '';
    const entries = Object.entries(voiceAliases);
    if (entries.length === 0) return '';
    return entries.map(([alias, name]) => `  - "${alias}" → "${name}"`).join('\n');
  }
}
