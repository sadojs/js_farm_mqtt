'use strict';

const fs = require('fs');
const yaml = require('js-yaml');
const { PROTECTED_FIELDS, getNestedValue, setNestedValue, removeProtectedFields } = require('./protected-fields');

/**
 * Zigbee2MQTT configuration.yaml 관리
 * - 읽기 / 백업 / 머지 / 쓰기
 * - 보호 필드 삼중 검증 (3차: Agent 측 최종 검증)
 * - 자동 롤백 (MQTT 연결 실패 시)
 */
class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.backupPath = configPath + '.bak';
    this.rollbackTimerMs = 60_000; // 설정 적용 후 60초 내 MQTT 재연결 안 되면 롤백
    this._rollbackTimer = null;
  }

  /** 현재 설정 읽기 (YAML → Object) */
  readConfig() {
    const content = fs.readFileSync(this.configPath, 'utf8');
    return yaml.load(content) || {};
  }

  /** 백업 생성 */
  createBackup() {
    fs.copyFileSync(this.configPath, this.backupPath);
  }

  /** 백업에서 복원 */
  restoreBackup() {
    if (fs.existsSync(this.backupPath)) {
      fs.copyFileSync(this.backupPath, this.configPath);
      return true;
    }
    return false;
  }

  /** 설정 저장 (Object → YAML) */
  writeConfig(config) {
    const content = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    fs.writeFileSync(this.configPath, content, 'utf8');
  }

  /**
   * 안전한 설정 머지 - 보호 필드 삼중 검증
   * @param {object} requestedConfig - 서버에서 전달받은 설정 (공통 설정만 있어야 함)
   * @returns {{ merged: object, changedFields: string[] }}
   */
  mergeConfig(requestedConfig) {
    const currentConfig = this.readConfig();

    // 1차: 요청에서 보호 필드 제거 (혹시 포함되어 있더라도)
    const safeRequest = removeProtectedFields(requestedConfig);

    // 2차: 현재 설정에 안전한 요청만 deep merge
    const merged = this._deepMerge(
      JSON.parse(JSON.stringify(currentConfig)),
      safeRequest,
    );

    // 3차: 보호 필드를 원본값으로 강제 복원
    for (const field of PROTECTED_FIELDS) {
      const originalValue = getNestedValue(currentConfig, field);
      if (originalValue !== undefined) {
        setNestedValue(merged, field, originalValue);
      }
    }

    // 변경된 필드 목록 추출
    const changedFields = this._findChangedFields(currentConfig, merged);

    return { merged, changedFields };
  }

  /**
   * 설정 적용 + 롤백 타이머 시작
   * 60초 내 MQTT Broker 연결이 복구되지 않으면 자동 롤백
   * @param {object} mergedConfig
   * @param {function} onRollback - 롤백 발생 시 콜백
   */
  applyWithRollbackGuard(mergedConfig, onRollback) {
    // 백업 생성
    this.createBackup();

    // 새 설정 저장
    this.writeConfig(mergedConfig);

    // 롤백 타이머 시작
    this.startRollbackTimer(onRollback);
  }

  /**
   * 롤백 타이머 시작
   * MQTT 재연결 성공 시 cancelRollback()으로 해제해야 함
   */
  startRollbackTimer(onRollback) {
    this.cancelRollback();
    this._rollbackTimer = setTimeout(() => {
      console.error('[CONFIG-AGENT] MQTT 재연결 타임아웃 - 자동 롤백 실행');
      const restored = this.restoreBackup();
      if (restored && onRollback) {
        onRollback();
      }
    }, this.rollbackTimerMs);
  }

  /** MQTT 재연결 성공 시 롤백 타이머 해제 */
  cancelRollback() {
    if (this._rollbackTimer) {
      clearTimeout(this._rollbackTimer);
      this._rollbackTimer = null;
    }
  }

  /** Deep merge (target에 source를 머지) */
  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  /** 두 설정 객체의 차이점 찾기 (dot notation으로 반환) */
  _findChangedFields(original, updated, prefix = '') {
    const changes = [];
    const allKeys = new Set([...Object.keys(original || {}), ...Object.keys(updated || {})]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;

      // 보호 필드는 변경 목록에서 제외
      if (PROTECTED_FIELDS.some(f => path === f || path.startsWith(f + '.'))) continue;

      const oldVal = original?.[key];
      const newVal = updated?.[key];

      if (
        oldVal && typeof oldVal === 'object' && !Array.isArray(oldVal) &&
        newVal && typeof newVal === 'object' && !Array.isArray(newVal)
      ) {
        changes.push(...this._findChangedFields(oldVal, newVal, path));
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push(path);
      }
    }
    return changes;
  }
}

module.exports = ConfigManager;
