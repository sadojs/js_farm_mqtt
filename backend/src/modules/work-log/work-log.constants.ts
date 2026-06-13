/**
 * 방울토마토 표준 작업 6종 — 신규 농장(user) 가입 시 또는 첫 진입 시 자동 시드.
 * PROMPT §1 의 권장 세트.
 */
export const STANDARD_WORK_TASK_TYPES: Array<{
  label: string;
  emoji: string;
  color: string;
  order: number;
}> = [
  { label: '하엽 제거',  emoji: '🍃', color: '#43a047', order: 1 },
  { label: '순지르기',   emoji: '✂️', color: '#00897b', order: 2 },
  { label: '유인(줄걸이)', emoji: '🪢', color: '#3949ab', order: 3 },
  { label: '수확(피킹)', emoji: '🍅', color: '#e53935', order: 4 },
  { label: '적과',       emoji: '✋', color: '#fb8c00', order: 5 },
  { label: '수정(벌)',   emoji: '🐝', color: '#fbc02d', order: 6 },
];

/** 이모지 팔레트 — 추가 모달 ※ 자유 입력 금지 */
export const EMOJI_PALETTE = [
  '🍃','✂️','🪢','🍅','✋','🐝','🌱','💧','🧴','🪣',
  '🧹','📦','🔧','🧪','☀️','🌡️','🐛','🍓','🥒','🌿',
];

/** 색 스와치 — 추가 모달 ※ 자유 컬러피커 금지 */
export const COLOR_SWATCHES = [
  '#43a047','#00897b','#3949ab','#e53935','#fb8c00',
  '#fbc02d','#8e24aa','#00838f','#607d8b','#5d4037',
];
