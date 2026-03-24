import { ref, readonly } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

const state = ref({
  visible: false,
  options: {} as ConfirmOptions,
  resolve: null as ((value: boolean) => void) | null,
})

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      state.value = {
        visible: true,
        options,
        resolve,
      }
    })
  }

  function handleConfirm() {
    state.value.resolve?.(true)
    state.value.visible = false
    state.value.resolve = null
  }

  function handleCancel() {
    state.value.resolve?.(false)
    state.value.visible = false
    state.value.resolve = null
  }

  return {
    state: readonly(state),
    confirm,
    handleConfirm,
    handleCancel,
  }
}
