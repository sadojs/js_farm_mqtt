/*
 * 자기소멸(self-destroying) 서비스워커.
 *
 * 배경: 과거 PWA 빌드가 이 오리진(예: https://localhost:5174)에 등록해 둔 "유령"
 * 서비스워커가, 이후 Vite 개발 서버로 바뀐 뒤에도 남아 옛 JS/CSS 모듈을 캐시로
 * 가로채는 문제가 있었다(수정을 배포해도 브라우저가 옛 화면을 계속 보여줌).
 * 개발 서버는 PWA devOptions.enabled=false 라 SW 를 쓰지 않으므로, /sw.js 로는
 * 이 파일(public/sw.js)이 서빙된다.
 *
 * 브라우저가 주기적으로 /sw.js 업데이트를 확인할 때 이 스크립트를 받으면:
 *  - 모든 캐시 삭제
 *  - 자신(서비스워커) 등록 해제
 *  - 열려 있는 탭 새로고침
 * → 유령 SW 가 사라지고 이후로는 개발 서버 자산이 항상 최신으로 로드된다.
 *
 * 프로덕션 빌드에서는 vite-plugin-pwa 가 dist/sw.js 를 따로 생성하므로 이 파일은
 * 개발 서버에서만 유효하다.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        /* 무시 */
      }
      try {
        await self.registration.unregister();
      } catch (e) {
        /* 무시 */
      }
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch (e) {
          /* 무시 */
        }
      }
    })(),
  );
});
