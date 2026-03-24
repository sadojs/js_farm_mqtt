import { BaseAutomationEngine, AutomationRule, Condition } from './base-engine.abstract';

/**
 * 날씨 기반 자동화 엔진
 *
 * 조건 예시:
 * - 비 → 자동 폐쇄 (필수)
 * - 강풍 → 개폐 제한 (옵션)
 * - 일출/일몰 → 조명 자동 (옵션)
 * - 온도에 따른 개폐기 동작 (필수)
 * - 온도에 하우스내 환풍기 동작 (필수)
 */
export class WeatherAutomationEngine extends BaseAutomationEngine {
  // TODO: WeatherService 주입
  // constructor(private weatherService: WeatherService) {}

  /**
   * 날씨 조건 평가
   */
  async evaluateConditions(rule: AutomationRule): Promise<boolean> {
    // TODO: 실제 날씨 API에서 데이터 가져오기
    const weatherData = await this.getCurrentWeather();

    const results: boolean[] = [];
    let currentOperator: 'AND' | 'OR' = 'AND';

    for (const condition of rule.conditions) {
      if (condition.type !== 'weather') continue;

      const actualValue = this.getWeatherValue(weatherData, condition.field);
      const result = this.evaluateCondition(condition, actualValue);

      if (condition.logicalOperator) {
        currentOperator = condition.logicalOperator;
      }

      results.push(result);
    }

    // AND/OR 로직 처리
    if (currentOperator === 'AND') {
      return results.every((r) => r === true);
    } else {
      return results.some((r) => r === true);
    }
  }

  /**
   * 액션 실행
   */
  async executeActions(rule: AutomationRule): Promise<void> {
    for (const action of rule.actions) {
      await this.executeAction(action);
    }
  }

  /**
   * 현재 날씨 가져오기
   */
  private async getCurrentWeather(): Promise<any> {
    // TODO: OpenWeather API 또는 기상청 API 호출
    return {
      temperature: 25,
      humidity: 60,
      precipitation: 0, // 강수량
      windSpeed: 5, // 풍속 m/s
      condition: 'clear', // clear, rain, snow, etc.
    };
  }

  /**
   * 날씨 데이터에서 특정 필드 값 추출
   */
  private getWeatherValue(weatherData: any, field: string): any {
    return weatherData[field];
  }

  /**
   * 개별 액션 실행
   */
  private async executeAction(action: any): Promise<void> {
    console.log(`Executing action: ${action.type} - ${action.command}`);

    // TODO: 실제 디바이스 제어
    // switch (action.type) {
    //   case 'device_control':
    //     await this.deviceService.sendCommand(action.deviceId, action.command);
    //     break;
    //   case 'notification':
    //     await this.notificationService.send(action.message);
    //     break;
    // }
  }
}

/**
 * 날씨 기반 자동화 룰 예시
 */
export const WEATHER_RULES_EXAMPLES = {
  // 비 → 자동 폐쇄
  rainAutoClose: {
    id: 'rain-auto-close',
    name: '비 올 때 자동 폐쇄',
    type: 'weather' as const,
    enabled: true,
    conditions: [
      {
        type: 'weather' as const,
        operator: 'eq' as const,
        field: 'condition',
        value: 'rain',
      },
    ],
    actions: [
      {
        type: 'device_control' as const,
        deviceId: 'roof-actuator',
        command: 'close',
      },
    ],
  },

  // 강풍 → 개폐 제한
  windSpeedLimit: {
    id: 'wind-speed-limit',
    name: '강풍 시 개폐 제한',
    type: 'weather' as const,
    enabled: true,
    conditions: [
      {
        type: 'weather' as const,
        operator: 'gt' as const,
        field: 'windSpeed',
        value: 15, // 15 m/s 이상
      },
    ],
    actions: [
      {
        type: 'device_control' as const,
        command: 'lock',
      },
    ],
  },

  // 온도 기반 환풍기 제어
  temperatureFan: {
    id: 'temp-fan-control',
    name: '온도 기반 환풍기 제어',
    type: 'weather' as const,
    enabled: true,
    conditions: [
      {
        type: 'weather' as const,
        operator: 'gt' as const,
        field: 'temperature',
        value: 28, // 28도 이상
      },
    ],
    actions: [
      {
        type: 'device_control' as const,
        deviceId: 'ventilation-fan',
        command: 'on',
        parameters: { speed: 'high' },
      },
    ],
  },
};
