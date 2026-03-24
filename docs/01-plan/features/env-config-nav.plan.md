# Plan: 환경 설정 버튼 네비게이션 및 리포트 데이터 숨김 (env-config-nav)

## 메타

| 항목 | 내용 |
|------|------|
| Feature | env-config-nav |
| Phase | Plan |
| 작성일 | 2026-03-02 |
| 우선순위 | High (버튼 미동작 + 잘못된 데이터 표시) |
| 관련 Feature | env-group-scope (이전 구현) |

---

## 발견된 버그

### Bug 1 — "환경 설정하기" 버튼 클릭 시 아무 동작 없음

#### 현상
- Sensors.vue (환경 모니터링) → env 미설정 그룹 확장 → "환경 설정하기" 클릭 → **아무 동작 없음**
- Reports.vue (리포트) → 경고 배너 내 "환경 설정하기" 클릭 → **아무 동작 없음**

#### 원인 분석
```
현재 코드 (Sensors.vue / Reports.vue):
  <router-link :to="`/settings/env-config?group=${group.id}`">환경 설정하기</router-link>

라우터 (router/index.ts):
  - /settings/env-config 라우트 없음
  - 환경설정(env-config)은 Groups.vue 내 인라인 모달로만 구현됨
    → openEnvConfig(group) 함수 → showEnvConfigModal = true

결과:
  /settings/env-config → 404 → 기존 화면 유지 → 아무 반응 없어 보임
```

### Bug 2 — 리포트 화면 env 미설정 그룹 선택 시 데이터 표시

#### 현상
스크린샷 확인:
- "연동 하우스" 선택 (env_mappings 없음)
- 경고 배너: "선택된 그룹의 환경 항목이 설정되지 않았습니다." ← 정상 표시
- 하단에 **평균 온도 0.5°C, 평균 습도 72.5%** 여전히 표시 ← 잘못된 동작

#### 원인 분석
```
Reports.vue의 loadAllData():
  → reportApi.getHourlyData({ groupId, ... })
  → 백엔드: 그룹에 할당된 센서의 sensor_data 반환 (env_mappings 무관)

template:
  <template v-else-if="hourlyData.length > 0">  ← envWarning 체크 없음
    통계 카드, 차트, 테이블 표시
  </template>

결과:
  envWarning = true여도 hourlyData에 데이터가 있으면 차트 표시됨
```

---

## 기대 동작

### "환경 설정하기" 버튼 클릭 시
```
Groups 페이지로 이동 + 해당 그룹의 환경설정 모달 자동 오픈
  → router.push('/groups?envConfig=<groupId>')
  → Groups.vue onMounted: query.envConfig 감지 → openEnvConfig(group) 자동 호출
```

### Reports.vue 데이터 표시 제어
```
envWarning = true (env 미설정):
  → 통계 카드, 차트, 테이블 숨김
  → "환경 설정 후 리포트를 확인할 수 있습니다." 안내 표시

envWarning = false (env 설정됨):
  → 기존 동작 유지
```

---

## 기능 요구사항

### FR-01: Sensors.vue — 환경 설정하기 네비게이션 수정
- `<router-link :to="`/settings/env-config?group=${group.id}`">`
  → `<router-link :to="`/groups?envConfig=${group.id}`">`

### FR-02: Reports.vue — 환경 설정하기 네비게이션 수정
- `<router-link :to="`/settings/env-config?group=${selectedGroup}`">`
  → `<router-link :to="`/groups?envConfig=${selectedGroup}`">`

### FR-03: Groups.vue — envConfig 쿼리 파라미터 감지 및 모달 자동 오픈
- `useRoute()` 추가 (이미 있을 수 있음)
- `onMounted`: `route.query.envConfig` 존재하면 해당 groupId로 `openEnvConfig` 자동 호출
- 그룹 데이터 로드 후 처리 (타이밍 주의)

### FR-04: Reports.vue — envWarning 시 데이터 숨김
- `<template v-else-if="hourlyData.length > 0">`
  → `<template v-else-if="hourlyData.length > 0 && !envWarning">`
- 빈 상태 메시지: envWarning 여부에 따라 다른 텍스트 표시

---

## 수정 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `views/Sensors.vue` | 수정 | router-link to 경로 변경 |
| `views/Reports.vue` | 수정 | router-link to 경로 변경 + v-else-if에 `!envWarning` 추가 |
| `views/Groups.vue` | 수정 | onMounted에서 route.query.envConfig 감지 → 모달 자동 오픈 |

---

## 성공 기준

1. Sensors.vue "환경 설정하기" 클릭 → Groups 페이지로 이동하고 해당 그룹의 환경설정 모달이 자동으로 열림
2. Reports.vue "환경 설정하기" 클릭 → 동일하게 동작
3. Reports.vue에서 env 미설정 그룹 선택 시 데이터 차트/통계가 표시되지 않고 안내 메시지 표시
4. vue-tsc + vite build 에러 없음
