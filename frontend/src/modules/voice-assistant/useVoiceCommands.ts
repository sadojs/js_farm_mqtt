import { ref } from 'vue'
import apiClient from '../../api/client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
  parsedBy?: 'rule' | 'claude'
  success?: boolean
}

export function useVoiceCommands() {
  const messages = ref<ChatMessage[]>([])
  const isProcessing = ref(false)

  async function sendCommand(text: string): Promise<string> {
    // 사용자 메시지 추가
    messages.value.push({
      role: 'user',
      text,
      timestamp: new Date(),
    })

    // 최근 10개만 유지
    if (messages.value.length > 10) {
      messages.value = messages.value.slice(-10)
    }

    isProcessing.value = true

    try {
      const { data } = await apiClient.post('/voice/command', { text }, { timeout: 30000 })

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        text: data.speech,
        timestamp: new Date(),
        parsedBy: data.parsedBy,
        success: data.success,
      }
      messages.value.push(assistantMsg)

      return data.speech
    } catch (error: any) {
      const errMsg = '서버와 통신에 실패했습니다. 잠시 후 다시 시도해주세요.'
      messages.value.push({
        role: 'assistant',
        text: errMsg,
        timestamp: new Date(),
        success: false,
      })
      return errMsg
    } finally {
      isProcessing.value = false
    }
  }

  function clearMessages() {
    messages.value = []
  }

  return {
    messages,
    isProcessing,
    sendCommand,
    clearMessages,
  }
}
