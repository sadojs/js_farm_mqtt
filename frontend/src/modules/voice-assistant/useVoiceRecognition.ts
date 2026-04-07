import { ref, onUnmounted } from 'vue'

// Web Speech API 타입 (브라우저 내장)
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

export function useVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const isSupported = !!SpeechRecognition

  const isListening = ref(false)
  const transcript = ref('')
  const interimText = ref('')

  let recognition: any = null

  function startListening(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!isSupported) {
        reject(new Error('음성 인식을 지원하지 않는 브라우저입니다.'))
        return
      }

      recognition = new SpeechRecognition()
      recognition.lang = 'ko-KR'
      recognition.interimResults = true
      recognition.continuous = false
      recognition.maxAlternatives = 1

      isListening.value = true
      transcript.value = ''
      interimText.value = ''

      recognition.onresult = (event: any) => {
        let interim = ''
        let final = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            final += t
          } else {
            interim += t
          }
        }
        if (final) transcript.value = final
        interimText.value = interim
      }

      recognition.onend = () => {
        isListening.value = false
        if (transcript.value) {
          resolve(transcript.value)
        } else {
          reject(new Error('음성을 인식하지 못했습니다.'))
        }
      }

      recognition.onerror = (event: any) => {
        isListening.value = false
        if (event.error === 'not-allowed') {
          reject(new Error('마이크 권한이 필요합니다. 브라우저 설정에서 허용해주세요.'))
        } else if (event.error === 'no-speech') {
          reject(new Error('음성이 감지되지 않았습니다. 다시 시도해주세요.'))
        } else {
          reject(new Error('음성 인식 오류가 발생했습니다.'))
        }
      }

      recognition.start()
    })
  }

  function stopListening() {
    if (recognition) {
      recognition.stop()
      isListening.value = false
    }
  }

  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve()
        return
      }

      // 기존 TTS 중지
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'ko-KR'
      utterance.rate = 1.1
      utterance.pitch = 1.0

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()

      window.speechSynthesis.speak(utterance)
    })
  }

  function cancelSpeak() {
    window.speechSynthesis?.cancel()
  }

  onUnmounted(() => {
    stopListening()
    cancelSpeak()
  })

  return {
    isSupported,
    isListening,
    transcript,
    interimText,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
  }
}
