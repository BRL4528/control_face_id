const CACHE = 'efrat-ponto-v1';
const ASSETS = [
  './index.html','./manifest.json','./vendor/face-api.js',
  './models/tiny_face_detector_model-weights_manifest.json',
  './models/tiny_face_detector_model.bin',
  './models/face_landmark_68_model-weights_manifest.json',
  './models/face_landmark_68_model.bin',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model.bin'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && new URL(e.request.url).origin === location.origin) {
      const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp));
    }
    return resp;
  }).catch(() => caches.match('./index.html'))));
});
