<template>
  <div class="web-terminal-wrapper">
    <div class="terminal-toolbar">
      <span class="terminal-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        {{ gatewayName }} 터미널
      </span>
      <div class="toolbar-actions">
        <span v-if="status === 'connecting'" class="status-badge connecting">연결 중…</span>
        <span v-else-if="status === 'connected'" class="status-badge connected">● 연결됨</span>
        <span v-else-if="status === 'error'" class="status-badge error">✕ 오류</span>
        <span v-else class="status-badge disconnected">○ 연결 끊김</span>
        <button class="btn-reconnect" :disabled="status === 'connecting'" @click="reconnect">재연결</button>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>
    </div>
    <div v-if="errorMessage" class="terminal-error">{{ errorMessage }}</div>
    <div ref="terminalEl" class="terminal-body" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth.store'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  gatewayId: string
  gatewayName?: string
}>()
defineEmits<{ (e: 'close'): void }>()

const authStore = useAuthStore()
const terminalEl = ref<HTMLElement | null>(null)
const status = ref<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle')
const errorMessage = ref('')

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let socket: Socket | null = null
let resizeObserver: ResizeObserver | null = null

const wsBase = import.meta.env.VITE_WS_URL || 'http://localhost:3100'

function initTerminal() {
  if (!terminalEl.value) return

  term = new Terminal({
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 2000,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalEl.value)
  fitAddon.fit()

  term.onData((data) => {
    if (socket?.connected) socket.emit('data', data)
  })

  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
    if (socket?.connected && term) {
      socket.emit('resize', { cols: term.cols, rows: term.rows })
    }
  })
  resizeObserver.observe(terminalEl.value)
}

function connect() {
  if (socket) { socket.disconnect(); socket = null }
  status.value = 'connecting'
  errorMessage.value = ''

  socket = io(`${wsBase}/ssh`, {
    auth: { token: authStore.accessToken },
    transports: ['websocket'],
  })

  socket.on('connect', () => {
    socket!.emit('connect_shell', {
      gatewayId: props.gatewayId,
      cols: term?.cols ?? 80,
      rows: term?.rows ?? 24,
    })
  })

  socket.on('ready', () => {
    status.value = 'connected'
    term?.focus()
  })

  socket.on('data', (chunk: string) => {
    term?.write(chunk)
  })

  socket.on('exit', () => {
    status.value = 'disconnected'
    term?.writeln('\r\n\x1b[33m--- 세션 종료 ---\x1b[0m')
  })

  socket.on('error', (err: { message: string }) => {
    status.value = 'error'
    errorMessage.value = err.message
    term?.writeln(`\r\n\x1b[31m오류: ${err.message}\x1b[0m`)
  })

  socket.on('disconnect', () => {
    if (status.value === 'connected') {
      status.value = 'disconnected'
      term?.writeln('\r\n\x1b[33m--- 연결이 끊어졌습니다 ---\x1b[0m')
    }
  })

  socket.on('connect_error', (err) => {
    status.value = 'error'
    errorMessage.value = `WebSocket 연결 실패: ${err.message}`
  })
}

function reconnect() {
  term?.clear()
  connect()
}

onMounted(() => {
  initTerminal()
  connect()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  socket?.disconnect()
  term?.dispose()
})

watch(() => props.gatewayId, () => {
  term?.clear()
  connect()
})
</script>

<style scoped>
.web-terminal-wrapper {
  display: flex;
  flex-direction: column;
  background: #0d1117;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #30363d;
  height: 100%;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c9d1d9;
  font-size: 13px;
  font-weight: 500;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}
.status-badge.connecting { color: #e3b341; background: #2d2208; }
.status-badge.connected  { color: #3fb950; background: #0d2a11; }
.status-badge.disconnected { color: #8b949e; background: #21262d; }
.status-badge.error      { color: #f85149; background: #2a0d0d; }

.btn-reconnect {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
}
.btn-reconnect:hover { background: #30363d; }
.btn-reconnect:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-close {
  font-size: 13px;
  background: none;
  border: none;
  color: #8b949e;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
}
.btn-close:hover { color: #f85149; }

.terminal-error {
  padding: 6px 12px;
  font-size: 12px;
  color: #f85149;
  background: #2a0d0d;
  border-bottom: 1px solid #f8514933;
}

.terminal-body {
  flex: 1;
  padding: 8px;
  overflow: hidden;
}
</style>
