'use strict';

/**
 * 보호 필드 목록 (dot notation)
 * 배포 시 절대 덮어쓰지 않는 게이트웨이 고유 설정
 */
const PROTECTED_FIELDS = [
  'mqtt.base_topic',
  'mqtt.server',
  'mqtt.user',
  'mqtt.password',
  'advanced.network_key',
  'advanced.pan_id',
  'serial',
  'devices',
  'groups',
];

/**
 * 중첩 객체에서 dot notation 경로로 값 조회
 * @param {object} obj
 * @param {string} path - 'advanced.network_key'
 */
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 중첩 객체에서 dot notation 경로로 값 설정
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 요청 설정에서 보호 필드 제거
 */
function removeProtectedFields(config) {
  const safe = JSON.parse(JSON.stringify(config));
  for (const field of PROTECTED_FIELDS) {
    const keys = field.split('.');
    let current = safe;
    for (let i = 0; i < keys.length - 1; i++) {
      if (current == null || typeof current !== 'object') break;
      current = current[keys[i]];
    }
    if (current != null && typeof current === 'object') {
      delete current[keys[keys.length - 1]];
    }
  }
  return safe;
}

module.exports = {
  PROTECTED_FIELDS,
  getNestedValue,
  setNestedValue,
  removeProtectedFields,
};
