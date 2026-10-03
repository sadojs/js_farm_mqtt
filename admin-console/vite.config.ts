import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * 관리자 콘솔 — 기존 frontend 와 분리된 별도 앱 (ARCHITECTURE.md).
 * - 기존 화면은 ../frontend/src 에서 그대로 import(읽기 전용). frontend 파일은 수정하지 않는다.
 * - 의존성은 콘솔 node_modules 하나만 사용(Vue/Pinia 중복 인스턴스 방지).
 * - 기존 api/client.ts 가 import 하는 기존 라우터는 콘솔 라우터 shim 으로 대체.
 */
const consoleRoot = fileURLToPath(new URL('.', import.meta.url))
const frontendSrc = path.resolve(consoleRoot, '../frontend/src')
const legacyRouterFile = path.join(frontendSrc, 'router/index.ts')
const routerShim = path.resolve(consoleRoot, 'src/router/legacy-router-shim.ts')
const stub = (name: string) => path.resolve(consoleRoot, `src/stubs/${name}.ts`)

/** 기존 라우터 모듈(frontend/src/router/index.ts)을 어떤 상대경로로 import 하든 콘솔 shim 으로 교체 */
function legacyRouterShim(): Plugin {
  return {
    name: 'console-legacy-router-shim',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !importer.startsWith(frontendSrc) || !source.includes('router')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && path.normalize(resolved.id.split('?')[0]) === legacyRouterFile) return routerShim
      return null
    },
  }
}

/** 기존 코드가 쓰는 외부 패키지 — 전부 콘솔 node_modules 에서 한 벌만 로드 */
const SHARED_DEPS = [
  'vue', 'vue-router', 'pinia', 'axios', 'socket.io-client', 'chart.js', 'vue-chartjs',
  '@xterm/xterm', '@xterm/addon-fit', '@vueuse/core', '@vuepic/vue-datepicker',
]

export default defineConfig({
  plugins: [legacyRouterShim(), vue(), basicSsl()],
  resolve: {
    alias: [
      { find: /^@console\//, replacement: path.resolve(consoleRoot, 'src') + '/' },
      { find: /^@\//, replacement: frontendSrc + '/' },
      // 콘솔은 PC·태블릿 웹 전용 — Capacitor(네이티브) 기능은 쓰지 않으므로 웹 동작(no-op) 스텁으로 대체
      { find: /^@capacitor\/core$/, replacement: stub('capacitor-core') },
      { find: /^@capacitor\/preferences$/, replacement: stub('capacitor-preferences') },
      { find: /^@capacitor\/push-notifications$/, replacement: stub('capacitor-push') },
      { find: /^@capacitor-community\/speech-recognition$/, replacement: stub('capacitor-speech') },
    ],
    dedupe: SHARED_DEPS,
  },
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    https: true,
    fs: { allow: [consoleRoot, frontendSrc] },
    proxy: {
      '/api': { target: 'http://localhost:3100', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3100', ws: true, changeOrigin: true },
    },
  },
  preview: { port: 5175, strictPort: true, https: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
