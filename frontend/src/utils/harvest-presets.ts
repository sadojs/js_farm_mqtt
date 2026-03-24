export interface CropPreset {
  name: string
  variety: string
  growDays: number
  stages: string[]
}

// 강원도 횡성군 군내면 기준
export const CROP_PRESETS: CropPreset[] = [
  { name: '방울토마토', variety: '대추방울', growDays: 100,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '방울토마토', variety: '미니찰', growDays: 90,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '방울토마토', variety: '탐스러운', growDays: 110,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
  { name: '딸기', variety: '설향', growDays: 120,
    stages: ['정식', '활착', '개화', '착과', '수확'] },
  { name: '오이', variety: '다다기', growDays: 60,
    stages: ['정식', '생장', '수확'] },
  { name: '고추', variety: '청양', growDays: 150,
    stages: ['육묘', '정식', '생장', '개화', '착과', '수확'] },
]

export function getStagesForCrop(cropName: string): string[] {
  const preset = CROP_PRESETS.find(p => p.name === cropName)
  return preset?.stages || ['파종', '생장', '수확']
}

// ── 작업 스케줄 템플릿 (강원도 횡성군 군내면 기준) ──

export interface TaskScheduleEntry {
  taskType: string
  taskName: string
  icon: string
  description: string
  firstTiming: {
    afterTransplant: string  // 예: "7~10일"
    afterSow: string         // 예: "30~40일"
  }
  stageIntervals: {
    stage: string
    label: string
    interval: string        // 예: "5~7일"
    note: string
  }[]
  effectDuration: string    // 예: "5일"
  tips: string[]
}

export const TASK_SCHEDULE: TaskScheduleEntry[] = [
  {
    taskType: 'training',
    taskName: '유인 작업',
    icon: '🌿',
    description: '줄기를 지지대에 유인하여 수광량 확보 및 통풍 개선',
    firstTiming: {
      afterTransplant: '7~10일',
      afterSow: '30~40일',
    },
    stageIntervals: [
      { stage: 'vegetative', label: '영양생장기', interval: '5~7일', note: '생장점이 빠르게 자라므로 자주 유인' },
      { stage: 'flowering_fruit', label: '개화착과기', interval: '7~10일', note: '화방 위치 고려하여 유인 방향 조절' },
      { stage: 'harvest', label: '수확기', interval: '10~14일', note: '생장 속도 둔화, 간격 넓힘' },
    ],
    effectDuration: '5일',
    tips: [
      '유인 끈은 줄기에 여유를 두고 느슨하게 감기',
      '오전 중 작업 시 줄기 꺾임 위험 감소',
      '습도 높은 날은 곰팡이 감염 방지를 위해 작업 자제',
    ],
  },
  {
    taskType: 'leaf_removal',
    taskName: '하엽 제거',
    icon: '🍃',
    description: '노화 하엽 제거로 통풍 개선 및 병해(잿빛곰팡이 등) 예방',
    firstTiming: {
      afterTransplant: '14~21일',
      afterSow: '45~55일',
    },
    stageIntervals: [
      { stage: 'vegetative', label: '영양생장기', interval: '10~14일', note: '잎 수 확보 필요, 적게 제거' },
      { stage: 'flowering_fruit', label: '개화착과기', interval: '7~10일', note: '착과 화방 아래 하엽 집중 제거' },
      { stage: 'harvest', label: '수확기', interval: '5~7일', note: '수확과 병행, 적극적 제거' },
    ],
    effectDuration: '7일',
    tips: [
      '한 번에 2~3장 이내로 제거 (과도한 제거 시 광합성 저하)',
      '결로/고습 시 작업 후 즉시 환기 필수',
      '잿빛곰팡이 감염 잎은 비닐봉지에 밀봉하여 반출',
    ],
  },
  {
    taskType: 'pesticide',
    taskName: '병충해 방제',
    icon: '🧴',
    description: '예방적 방제로 잿빛곰팡이·흰가루병·진딧물 등 억제',
    firstTiming: {
      afterTransplant: '7~14일',
      afterSow: '30~40일',
    },
    stageIntervals: [
      { stage: 'vegetative', label: '영양생장기', interval: '10~14일', note: '예방 위주 살균제 중심' },
      { stage: 'flowering_fruit', label: '개화착과기', interval: '10~14일', note: '수정벌 피해 방지, 저독성 약제 사용' },
      { stage: 'harvest', label: '수확기', interval: '14~21일', note: '잔류 농약 기준 준수, 안전사용기준 확인' },
    ],
    effectDuration: '12일',
    tips: [
      '농약안전사용기준(PHI) 반드시 확인 후 살포',
      '습도 80% 이상 지속 시 잿빛곰팡이 예방 살포 권장',
      '같은 계열 약제 연속 사용 금지 (내성 방지)',
      '살포 시 하엽~상엽 골고루 도포, 잎 뒷면까지',
    ],
  },
]
