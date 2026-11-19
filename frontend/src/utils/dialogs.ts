import { useConfirm } from '../composables/useConfirm'
import { useNotificationStore } from '../stores/notification.store'

/**
 * 브라우저 기본 alert/confirm 대신 쓰는 앱 공통 알림·확인창.
 * (기본 창은 다크 모드·모바일 앱(WebView)에서 어색하고 문구·모양이 화면마다 달랐다.)
 */

type Kind = 'success' | 'error' | 'warning' | 'info'

function inferKind(message: string): Kind {
  if (/실패|오류|권한이 없/.test(message)) return 'error'
  if (/해 주세요|해주세요|커야|먼저|지연/.test(message)) return 'warning'
  if (/완료|되었습니다|했습니다|발행/.test(message)) return 'success'
  return 'info'
}

const TITLE: Record<Kind, string> = { success: '완료', error: '실패', warning: '확인', info: '안내' }

/** 토스트로 알린다. 종류를 생략하면 문구로 판단한다. */
export function notify(message: string, kind?: Kind) {
  const k = kind ?? inferKind(message)
  const store = useNotificationStore()
  store[k](TITLE[k], message)
}

/** 앱 확인창. 삭제·해제·정지 문구면 위험(빨강) 모양. */
export function askConfirm(message: string, opts: { title?: string; confirmText?: string; variant?: 'danger' | 'warning' | 'info' } = {}): Promise<boolean> {
  const { confirm } = useConfirm()
  const danger = /삭제|해제|정지|사라집니다/.test(message)
  return confirm({
    title: opts.title ?? (danger ? '정말 진행할까요?' : '확인해 주세요'),
    message,
    confirmText: opts.confirmText,
    variant: opts.variant ?? (danger ? 'danger' : 'warning'),
  })
}
