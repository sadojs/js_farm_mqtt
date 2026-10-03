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

  async function callApi(text: string) {
    // 서버 AI 응답이 보통 20~25초, 최대 50초 → 그보다 길게 대기
    return apiClient.post('/voice/command', { text }, { timeout: 60000 })
  }

  async function sendCommand(text: string): Promise<string> {
    messages.value.push({
      role: 'user',
      text,
      timestamp: new Date(),
    })

    if (messages.value.length > 10) {
      messages.value = messages.value.slice(-10)
    }

    isProcessing.value = true

    try {
      // 1차 시도
      let data: any
      try {
        const res = await callApi(text)
        data = res.data
      } catch (firstError: any) {
        // 네트워크 에러(요청이 서버에 안 닿음)만 1회 재시도.
        // 타임아웃은 서버가 이미 명령을 실행했을 수 있어 재전송하면 중복 실행(예: 방재 연장 2번)된다.
        if (!firstError.response && firstError.code !== 'ECONNABORTED') {
          try {
            const res = await callApi(text)
            data = res.data
          } catch {
            throw firstError
          }
        } else {
          throw firstError
        }
      }

      messages.value.push({
        role: 'assistant',
        text: data.speech,
        timestamp: new Date(),
        parsedBy: data.parsedBy,
        success: data.success,
      })

      return data.speech
    } catch (error: any) {
      const errMsg = error.code === 'ECONNABORTED'
        ? '응답 시간이 초과되었습니다. 다시 시도해주세요.'
        : '서버와 통신에 실패했습니다. 잠시 후 다시 시도해주세요.'
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
