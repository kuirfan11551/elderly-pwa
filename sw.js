/* =====================================================================
 *  Service Worker — ประเมินผู้สูงอายุ รพ.ยะรัง (PWA offline shell)
 *  - precache แอปเชลล์ → เปิดแอปได้แม้ไม่มีเน็ต
 *  - คำขอ navigation: คืน index.html จากแคช (offline-first)
 *  - static อื่นๆ: cache-first + อัปเดตเบื้องหลัง (stale-while-revalidate)
 *  - คำขอไป GAS API (POST/exec): ไม่แตะ ปล่อยให้ network จัดการ
 *    (ออฟไลน์ = fetch ล้มเหลว → outbox ในหน้าเว็บจะ retry เอง)
 *  *** เปลี่ยน CACHE เวอร์ชันทุกครั้งที่แก้ไฟล์ static เพื่อล้างแคชเก่า ***
 * ===================================================================== */
const CACHE = 'eld-pwa-v3';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(req) {
  // อย่าแคชคำขอไป GAS / API ทุกชนิด (ต้องสดเสมอ)
  if (req.method !== 'GET') return true;
  return /script\.google\.com|googleusercontent\.com|\/exec(\?|$)/.test(req.url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (isApiRequest(req)) return;                       // ปล่อยผ่าน (network)

  // navigation → offline-first: ลองเน็ตก่อน, ล้มเหลวคืน index.html จากแคช
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // static → cache-first + เติมแคชเบื้องหลัง
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
