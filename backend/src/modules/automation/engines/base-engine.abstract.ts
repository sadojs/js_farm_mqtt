/**
 * 자동화 룰 정의
 */
export interface AutomationRule {
  id: string;
  name: string;
  type: 'weather' | 'time' | 'hybrid';
  enabled: boolean;
  conditions: Condition[];
  actions: Action[];
  groupId?: string;
}

/**
 * 조건 정의
 */
export interface Condition {
  type: 'weather' | 'time' | 'sensor';
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte';
  field: string;
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

/**
 * 액션 정의
 */
export interface Action {
  type: 'device_control' | 'notification' | 'group_control';
  deviceId?: string;
  groupId?: string;
  command: string;
  parameters?: Record<string, any>;
}

/**
 * 자동화 엔진 추상 클래스
 */
export abstract class BaseAutomationEngine {
  /**
   * 조건 평가
   */
  abstract evaluateConditions(rule: AutomationRule): Promise<boolean>;

  /**
   * 액션 실행
   */
  abstract executeActions(rule: AutomationRule): Promise<void>;

  /**
   * 룰 처리 (공통 로직)
   */
  async process(rule: AutomationRule): Promise<boolean> {
    if (!rule.enabled) {
      return false;
    }

    try {
      const conditionsMet = await this.evaluateConditions(rule);

      if (conditionsMet) {
        await this.executeActions(rule);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Error processing rule ${rule.id}:`, error);
      return false;
    }
  }

  /**
   * 조건 평가 헬퍼
   */
  protected evaluateCondition(condition: Condition, actualValue: any): boolean {
    const { operator, value } = condition;

    switch (operator) {
      case 'eq':
        return actualValue === value;
      case 'ne':
        return actualValue !== value;
      case 'gt':
        return actualValue > value;
      case 'lt':
        return actualValue < value;
      case 'gte':
        return actualValue >= value;
      case 'lte':
        return actualValue <= value;
      default:
        return false;
    }
  }
}
