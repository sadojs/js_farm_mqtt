# dashboard-summary-navigation Design Document

> **Summary**: 대시보드 하단 요약 카드 클릭 시 해당 관리 페이지로 이동 + 농장사용자 권한 제한
>
> **Project**: smart-farm-platform
> **Date**: 2026-03-04
> **Status**: Draft
> **Plan Reference**: `docs/01-plan/features/dashboard-summary-navigation.plan.md`

---

## 1. Architecture

### 1.1 변경 범위

프론트엔드 Only. 백엔드/DB 변경 없음.

### 1.2 수정 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `frontend/src/components/dashboard/SummaryCards.vue` | 수정 | router + auth store import, 카드 클릭 네비게이션, 권한 분기, CSS |

신규 파일 없음.

---

## 2. Detailed Design

### 2.1 Navigation Mapping

| 카드 | 라벨 | 이동 경로 | denyFarmUser |
|------|------|-----------|:------------:|
| 전체 장비 | `전체 장비` | `/devices` | Yes |
| 활성 그룹 | `활성 그룹` | `/groups` | No |
| 자동화 룰 | `자동화 룰` | `/automation` | Yes |
| 온라인 기기 | `온라인 기기` | `/devices` | Yes |

### 2.2 Script 변경

```typescript
// 추가 import
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth.store'

// store / router 초기화
const router = useRouter()
const authStore = useAuthStore()

// 네비게이션 설정 (배열로 관리)
const summaryCards = [
  { route: '/devices',    denyFarmUser: true  },  // 전체 장비
  { route: '/groups',     denyFarmUser: false },  // 활성 그룹
  { route: '/automation', denyFarmUser: true  },  // 자동화 룰
  { route: '/devices',    denyFarmUser: true  },  // 온라인 기기
]

// 클릭 가능 여부 판단
function canNavigate(index: number): boolean {
  if (summaryCards[index].denyFarmUser && authStore.isFarmUser) return false
  return true
}

// 카드 클릭 핸들러
function navigateTo(index: number) {
  if (!canNavigate(index)) return
  router.push(summaryCards[index].route)
}
```

### 2.3 Template 변경

현재 `.summary-item` div에 `@click`과 동적 class를 추가:

```vue
<!-- 변경 전 -->
<div class="summary-item">

<!-- 변경 후 -->
<div
  :class="['summary-item', canNavigate(0) && 'summary-item-link']"
  @click="navigateTo(0)"
>
```

4개 카드에 각각 index 0~3 적용.

### 2.4 CSS 변경

```css
/* 클릭 가능한 카드 */
.summary-item-link {
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.summary-item-link:hover {
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.summary-item-link:active {
  transform: translateY(0);
}
```

농장 사용자의 비활성 카드: `canNavigate` false → `.summary-item-link` class 미적용 → 기본 cursor, hover 효과 없음. 추가 disabled 스타일 불필요 (기존 카드와 동일한 외관 유지).

---

## 3. Implementation Order

| Step | 내용 | 검증 |
|------|------|------|
| 1 | `useRouter`, `useAuthStore` import 추가 | TypeScript 에러 없음 |
| 2 | `summaryCards` 배열 + `canNavigate` + `navigateTo` 함수 정의 | TypeScript 에러 없음 |
| 3 | 4개 `.summary-item`에 `@click` + `:class` 바인딩 (index 0~3) | 템플릿 수정 |
| 4 | `.summary-item-link` CSS 추가 | hover/cursor 동작 |
| 5 | `vue-tsc --noEmit` + `vite build` 검증 | 빌드 통과 |

---

## 4. Verification Checklist

| ID | 항목 | Category |
|----|------|----------|
| V-01 | 전체 장비 카드 클릭 → `/devices` 이동 | Navigation |
| V-02 | 활성 그룹 카드 클릭 → `/groups` 이동 | Navigation |
| V-03 | 자동화 룰 카드 클릭 → `/automation` 이동 | Navigation |
| V-04 | 온라인 기기 카드 클릭 → `/devices` 이동 | Navigation |
| V-05 | admin/farm_admin: 4개 카드 모두 클릭 가능 + hover 효과 | Auth |
| V-06 | farm_user: 활성 그룹만 클릭 가능 | Auth |
| V-07 | farm_user: 전체 장비/자동화 룰/온라인 기기 클릭 불가 + hover 없음 | Auth |
| V-08 | 클릭 가능 카드에 cursor: pointer 표시 | CSS |
| V-09 | vue-tsc + vite build 통과 | Build |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-03-04 | Initial draft | AI |
