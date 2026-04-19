const GROWTH_STAGES = [
  { key: 'germination',   label: '발아기',    emoji: '🌱', minGdd: 0,    maxGdd: 80 },
  { key: 'seedling',      label: '육묘기',    emoji: '🌿', minGdd: 80,   maxGdd: 200 },
  { key: 'establishment', label: '활착기',    emoji: '💪', minGdd: 200,  maxGdd: 350 },
  { key: 'vegetative',    label: '영양생장기', emoji: '🌾', minGdd: 350,  maxGdd: 600 },
  { key: 'flowering',     label: '개화착과기', emoji: '🌸', minGdd: 600,  maxGdd: 900 },
  { key: 'fruiting',      label: '과비대기',  emoji: '🍅', minGdd: 900,  maxGdd: 1200 },
  { key: 'harvest',       label: '수확기',    emoji: '✂️', minGdd: 1200, maxGdd: Infinity },
]

export function resolveGrowthStage(gdd: number) {
  return (
    GROWTH_STAGES.find(s => gdd >= s.minGdd && gdd < s.maxGdd) ??
    GROWTH_STAGES[GROWTH_STAGES.length - 1]
  )
}
