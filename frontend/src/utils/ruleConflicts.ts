import { automationApi } from '../api/automation.api'
import { useConfirm } from '../composables/useConfirm'

export interface SaveConflict {
  ruleId: string
  ruleName: string
  deviceNames: string[]
  reason: string
}

/**
 * 저장(또는 켜기) 전에 같은 장치를 반대로 움직일 수 있는 켜진 규칙이 있는지 확인하고,
 * 있으면 "저장하면 기존 규칙은 꺼집니다" 확인창을 띄운다.
 *
 * 반환: 끌 규칙 id 목록(충돌이 없으면 빈 배열) · 사용자가 취소하면 null.
 * 확인 요청 자체가 실패하면 저장을 막지 않는다(빈 배열) — 실행 중 충돌 팝업이 뒤에서 한 번 더 지켜 준다.
 */
export async function confirmRuleConflicts(
  payload: { ruleId?: string; groupId?: string; conditions: any; actions: any },
  mode: 'create' | 'update' | 'enable',
): Promise<string[] | null> {
  let conflicts: SaveConflict[] = []
  try {
    const { data } = await automationApi.checkConflicts(payload)
    conflicts = data?.conflicts ?? []
  } catch {
    return []
  }
  if (conflicts.length === 0) return []

  const lines = conflicts.map(c => `• "${c.ruleName}" — ${c.deviceNames.join(', ')}\n   ${c.reason}`).join('\n')
  const verb = mode === 'enable' ? '켜면' : '저장하면'
  const { confirm } = useConfirm()
  const ok = await confirm({
    title: '같은 장치를 움직이는 규칙이 있습니다',
    message: `${lines}\n\n${verb} 위 규칙${conflicts.length > 1 ? '들' : ''}은 꺼집니다(비활성화).\n나중에 목록에서 다시 켤 수 있습니다.`,
    confirmText: mode === 'enable' ? '켜고 기존 규칙 끄기' : '저장하고 기존 규칙 끄기',
    cancelText: '취소',
    variant: 'warning',
  })
  return ok ? conflicts.map(c => c.ruleId) : null
}
