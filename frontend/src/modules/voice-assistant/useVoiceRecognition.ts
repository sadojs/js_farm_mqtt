import { ref, onUnmounted } from 'vue'
import { Capacitor } from '@capacitor/core'
// 네이티브 음성인식 플러그인. 정적 import 사용(웹에선 호출 안 하면 무해).
// ⚠️ async 함수가 이 플러그인 프록시를 resolve 값으로 반환하면 Capacitor 프록시의 .then 접근 때문에
//    "SpeechRecognition.then() is not implemented" 오류가 난다 → 프록시를 await/return 하지 말 것.
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition'

// Web Speech API 타입 (브라우저 내장)
declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

export function useVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  // 네이티브 앱(Capacitor WebView)은 Web Speech API 음성인식을 지원하지 않는다(WebView엔 음성 서비스 미연결 →
  // webkitSpeechRecognition.start() 가 'not-allowed' 로 실패). 그래서 앱에선 네이티브 플러그인
  // (@capacitor-community/speech-recognition: Android SpeechRecognizer / iOS SFSpeechRecognizer)을 쓴다.
  const isNative = Capacitor.isNativePlatform()
  const isSupported = isNative || !!SpeechRecognition

  const isListening = ref(false)
  const transcript = ref('')
  const interimText = ref('')

  let recognition: any = null

  // ── 네이티브(Capacitor) 경로 ──
  let nativePartialH: any = null
  let nativeStateH: any = null
  let nativeFinish: ((ok: boolean) => void) | null = null

  async function startNative(): Promise<string> {
    let perm = await NativeSpeech.checkPermissions().catch(() => ({ speechRecognition: 'prompt' as const }))
    if (perm.speechRecognition !== 'granted') {
      perm = await NativeSpeech.requestPermissions().catch(() => ({ speechRecognition: 'denied' as const }))
    }
    if (perm.speechRecognition !== 'granted') {
      throw new Error('마이크 권한이 필요합니다. 설정 > 앱 권한에서 마이크를 허용해주세요.')
    }

    isListening.value = true
    transcript.value = ''
    interimText.value = ''

    return new Promise<string>((resolve, reject) => {
      let last = ''
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        isListening.value = false
        nativePartialH?.remove?.(); nativePartialH = null
        nativeStateH?.remove?.(); nativeStateH = null
        nativeFinish = null
        if (ok && last) { transcript.value = last; resolve(last) }
        else reject(new Error('음성을 인식하지 못했습니다.'))
      }
      nativeFinish = finish
      ;(async () => {
        nativePartialH = await NativeSpeech.addListener('partialResults', (data: any) => {
          const m = data?.matches?.[0]
          if (m) { last = m; interimText.value = m }
        })
        nativeStateH = await NativeSpeech.addListener('listeningState', (data: any) => {
          if (data?.status === 'stopped') finish(true)
        })
        try {
          await NativeSpeech.start({ language: 'ko-KR', partialResults: true, popup: false, maxResults: 1 })
        } catch {
          finish(false)
        }
      })()
    })
  }

  async function stopNative() {
    try {
      await NativeSpeech.stop()
    } catch { /* noop */ }
    // listeningState 'stopped' 이벤트가 안 오는 기기 대비 폴백
    setTimeout(() => nativeFinish?.(true), 600)
  }

  function startListening(): Promise<string> {
    if (isNative) return startNative()
    return new Promise((resolve, reject) => {
      if (!SpeechRecognition) {
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
    if (isNative) {
      void stopNative()
      return
    }
    if (recognition) {
      recognition.stop()
      isListening.value = false
    }
  }

  // 모바일: 사용자 제스처 시점에 빈 음성으로 speechSynthesis 활성화
  function unlockAudio() {
    if (!window.speechSynthesis) return
    const empty = new SpeechSynthesisUtterance('')
    empty.volume = 0
    window.speechSynthesis.speak(empty)
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

      // 모바일에서 onend가 안 불리는 버그 대비 타임아웃
      const maxWait = Math.max(text.length * 150, 3000) // 글자당 150ms, 최소 3초
      const timer = setTimeout(() => {
        window.speechSynthesis.cancel()
        resolve()
      }, maxWait)

      utterance.onend = () => { clearTimeout(timer); resolve() }
      utterance.onerror = () => { clearTimeout(timer); resolve() }

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
    unlockAudio,
  }
}
