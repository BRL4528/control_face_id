// Cache dos estáticos. As chamadas de API nunca passam por aqui: resposta de
// marcação em cache seria mentira sobre o que o servidor recebeu.
const CACHE = 'efrat-ponto-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/fontes.css',
  './css/tema.css',
  './vendor/face-api.js',
  './vendor/chart.umd.min.js',
  './vendor/fontes/plus-jakarta-sans-latin-400-normal.woff2',
  './vendor/fontes/plus-jakarta-sans-latin-500-normal.woff2',
  './vendor/fontes/plus-jakarta-sans-latin-600-normal.woff2',
  './vendor/fontes/plus-jakarta-sans-latin-700-normal.woff2',
  './vendor/fontes/plus-jakarta-sans-latin-800-normal.woff2',
  './vendor/fontes/ibm-plex-mono-latin-400-normal.woff2',
  './vendor/fontes/ibm-plex-mono-latin-500-normal.woff2',
  './vendor/fontes/ibm-plex-mono-latin-600-normal.woff2',
  './js/config.js',
  './js/app.js',
  './js/api.js',
  './js/face.js',
  './js/regras.js',
  './js/store.js',
  './js/ui.js',
  './js/fila.js',
  './js/rh.js',
  './js/gestor.js',
  './js/cripto.js',
  './icon-192.png',
  './icon-512.png',
  './models/tiny_face_detector_model-weights_manifest.json',
  './models/tiny_face_detector_model.bin',
  './models/face_landmark_68_model-weights_manifest.json',
  './models/face_landmark_68_model.bin',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model.bin'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // API e CDNs passam direto
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
