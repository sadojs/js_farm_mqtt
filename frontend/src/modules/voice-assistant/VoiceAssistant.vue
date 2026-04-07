<template>
  <div class="voice-assistant">
    <!-- 플로팅 마이크 버튼 (패널 열리면 숨김) -->
    <button
      v-if="!panelOpen"
      class="voice-fab"
      @click="openPanel"
      title="음성 어시스턴트"
    >
      <svg class="fab-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- 마이크 본체 -->
        <rect x="9" y="3" width="6" height="10" rx="3" fill="white"/>
        <!-- 마이크 아래 호 -->
        <path d="M6 12C6 15.3 8.7 18 12 18C15.3 18 18 15.3 18 12" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>
        <!-- 마이크 스탠드 -->
        <line x1="12" y1="18" x2="12" y2="21" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
        <!-- AI 파동 -->
        <path d="M3 9C3 9 4 11 3 13" stroke="rgba(255,255,255,0.5)" stroke-width="1" stroke-linecap="round"/>
        <path d="M1 8C1 8 2.5 11 1 14" stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-linecap="round"/>
        <path d="M21 9C21 9 20 11 21 13" stroke="rgba(255,255,255,0.5)" stroke-width="1" stroke-linecap="round"/>
        <path d="M23 8C23 8 21.5 11 23 14" stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- 대화 패널 -->
    <Transition name="slide-up">
      <div v-if="panelOpen" class="voice-panel">
        <div class="panel-header">
          <span class="panel-title">음성 어시스턴트</span>
          <button class="btn-close" @click="closePanel">✕</button>
        </div>

        <div class="panel-messages" ref="messagesEl">
          <div v-if="messages.length === 0" class="empty-hint">
            <template v-if="isSupported">
              🎙 말하기 버튼을 누르거나 텍스트로 입력하세요
            </template>
            <template v-else>
              이 브라우저에서는 음성 인식이 지원되지 않습니다.<br>
              텍스트로 명령을 입력해주세요.<br>
              <span class="hint-small">예: "팬 켜줘", "날씨 알려줘"</span>
            </template>
          </div>
          <div
            v-for="(msg, i) in messages"
            :key="i"
            class="message"
            :class="msg.role"
          >
            <span class="msg-icon">{{ msg.role === 'user' ? '🧑' : '🤖' }}</span>
            <span class="msg-text">{{ msg.text }}</span>
          </div>

          <!-- 듣는 중 표시 -->
          <div v-if="isListening" class="message listening-indicator">
            <span class="msg-icon">🎙</span>
            <span class="msg-text interim">{{ interimText || '듣고 있습니다...' }}</span>
          </div>

          <!-- 처리 중 표시 -->
          <div v-if="isProcessing" class="message processing-indicator">
            <span class="msg-icon">⏳</span>
            <span class="msg-text">처리 중...</span>
          </div>
        </div>

        <div class="panel-input">
          <!-- 음성 버튼: 지원되는 브라우저에서만 표시 -->
          <button
            v-if="isSupported"
            class="btn-mic"
            :class="{ active: isListening }"
            :disabled="isProcessing"
            @click="handleVoiceInput"
          >
            {{ isListening ? '⏹' : '🎙' }}
          </button>
          <input
            ref="textInputEl"
            v-model="textInput"
            type="text"
            class="text-input"
            :placeholder="isSupported ? '텍스트로도 입력 가능' : '명령을 입력하세요'"
            :disabled="isProcessing"
            @keyup.enter="handleTextInput"
          />
          <button
            class="btn-send"
            :disabled="!textInput.trim() || isProcessing"
            @click="handleTextInput"
          >
            전송
          </button>
        </div>
      </div>
    </Transition>

    <!-- 패널 배경 오버레이 -->
    <div v-if="panelOpen" class="voice-overlay" @click="closePanel" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useVoiceRecognition } from './useVoiceRecognition'
import { useVoiceCommands } from './useVoiceCommands'

const { isSupported, isListening, interimText, startListening, stopListening, speak, cancelSpeak, unlockAudio } = useVoiceRecognition()
const { messages, isProcessing, sendCommand } = useVoiceCommands()

const panelOpen = ref(false)
const textInput = ref('')
const isSpeaking = ref(false)
const messagesEl = ref<HTMLElement | null>(null)
const textInputEl = ref<HTMLInputElement | null>(null)

function openPanel() {
  panelOpen.value = true
  document.body.style.overflow = 'hidden'
  nextTick(() => {
    if (!isSupported) {
      textInputEl.value?.focus()
    }
  })
}

function closePanel() {
  panelOpen.value = false
  document.body.style.overflow = ''
  stopListening()
  cancelSpeak()
}

async function handleVoiceInput() {
  unlockAudio() // 모바일 TTS 활성화

  if (isListening.value) {
    stopListening()
    return
  }

  // TTS 중이면 중단
  if (isSpeaking.value) {
    cancelSpeak()
    isSpeaking.value = false
  }

  try {
    const text = await startListening()
    if (text) {
      await processCommand(text)
    }
  } catch (error: any) {
    const errMsg = error.message || '음성 인식에 실패했습니다.'
    messages.value.push({ role: 'assistant', text: errMsg, timestamp: new Date(), success: false })
  }
}

async function handleTextInput() {
  const text = textInput.value.trim()
  if (!text || isProcessing.value) return
  unlockAudio() // 모바일 TTS 활성화
  textInput.value = ''
  await processCommand(text)
}

async function processCommand(text: string) {
  const speech = await sendCommand(text)
  // TTS로 응답 읽기 (지원 브라우저에서만)
  if (speech && isSupported) {
    isSpeaking.value = true
    await speak(speech)
    isSpeaking.value = false
  }
}

// 메시지 추가 시 스크롤 하단으로
watch(() => messages.value.length, () => {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
})
</script>

<style scoped>
.voice-assistant {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
}

.voice-assistant > * {
  pointer-events: auto;
}

/* 플로팅 버튼 */
.voice-fab {
  position: fixed;
  right: 20px;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 50%, #2563eb 100%);
  cursor: pointer;
  box-shadow:
    0 4px 15px rgba(109, 40, 217, 0.4),
    0 0 20px rgba(79, 70, 229, 0.2);
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  padding: 0;
}

.voice-fab:hover {
  transform: scale(1.1);
  box-shadow:
    0 6px 20px rgba(109, 40, 217, 0.5),
    0 0 30px rgba(79, 70, 229, 0.3);
}

.voice-fab:active {
  transform: scale(0.95);
}

.fab-svg {
  width: 28px;
  height: 28px;
}

/* 오버레이 */
.voice-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100dvh;
  background: rgba(0, 0, 0, 0.3);
  z-index: 9998;
}

/* 대화 패널 */
.voice-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 45dvh;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  z-index: 10000;
  overflow: hidden;
  -webkit-overflow-scrolling: touch;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  flex-shrink: 0;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.btn-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  color: var(--text-secondary, #64748b);
}

/* 메시지 영역 */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  min-height: 60px;
  max-height: 25dvh;
}

.empty-hint {
  text-align: center;
  color: var(--text-secondary, #94a3b8);
  font-size: 13px;
  padding: 24px 0;
  line-height: 1.8;
}

.hint-small {
  font-size: 12px;
  opacity: 0.7;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  line-height: 1.5;
}

.message.user {
  justify-content: flex-end;
}

.message.user .msg-text {
  background: var(--primary-color, #2563eb);
  color: #fff;
  border-radius: 12px 12px 0 12px;
  padding: 8px 12px;
  max-width: 80%;
}

.message.assistant .msg-text {
  background: var(--bg-secondary, #f1f5f9);
  border-radius: 12px 12px 12px 0;
  padding: 8px 12px;
  max-width: 80%;
}

.msg-icon {
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1.6;
}

.interim {
  color: var(--text-secondary, #94a3b8);
  font-style: italic;
}

.listening-indicator, .processing-indicator {
  opacity: 0.7;
}

/* 입력 영역 */
.panel-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e2e8f0);
  flex-shrink: 0;
}

.btn-mic {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 50%;
  background: var(--card-bg, #fff);
  font-size: 18px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-mic.active {
  background: #dc2626;
  color: #fff;
  border-color: #dc2626;
  animation: pulse-anim 1s infinite;
}

.btn-mic:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse-anim {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.text-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  min-width: 0;
}

.text-input:focus {
  border-color: var(--primary-color, #2563eb);
}

.btn-send {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary-color, #2563eb);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 슬라이드업 트랜지션 */
.slide-up-enter-active, .slide-up-leave-active {
  transition: transform 0.3s ease;
}
.slide-up-enter-from, .slide-up-leave-to {
  transform: translateY(100%);
}

/* 다크모드 — CSS 변수 기반 (theme-dark 클래스가 부모에 있으므로 변수로 처리) */
.voice-panel {
  background: var(--bg-card, #fff);
  color: var(--text-primary, #1e293b);
}
.panel-title {
  color: var(--text-primary, #1e293b);
}
.btn-close {
  color: var(--text-muted, #64748b);
}
.message.assistant .msg-text {
  background: var(--bg-secondary, #f1f5f9);
  color: var(--text-primary, #1e293b);
}
.empty-hint {
  color: var(--text-muted, #94a3b8);
}
.panel-header {
  border-color: var(--border-color, #e2e8f0);
}
.panel-input {
  border-color: var(--border-color, #e2e8f0);
}
.text-input {
  background: var(--bg-input, #fff);
  color: var(--text-primary, #1e293b);
  border-color: var(--border-color, #e2e8f0);
}
.btn-mic {
  background: var(--bg-input, #fff);
  color: var(--text-primary, #1e293b);
  border-color: var(--border-color, #e2e8f0);
}

/* 데스크톱: 패널을 우측 하단에 */
@media (min-width: 768px) {
  .voice-panel {
    left: auto;
    right: 20px;
    bottom: 20px;
    width: 380px;
    max-height: 500px;
    border-radius: 16px;
  }
}
</style>
