// Cache dos estáticos. As chamadas de API nunca passam por aqui: resposta de
// marcação em cache seria mentira sobre o que o servidor recebeu.
const CACHE = 'efrat-ponto-v8';
// BACKSTOP. A pagina publica de cadastro de face vive em ORIGEM PROPRIA
// (projeto separado da Vercel, Root Directory publico/) — ver publico/LEIA-ME.md.
// A fronteira de verdade e a origem, garantida por AUSENCIA: .vercelignore tira
// publico/ do deploy do app, entao esses arquivos nao existem aqui.
//
// Este desvio e o que sobra se aquela garantia falhar. Se publico/ escapar para
// o deploy do app, ele responde em /publico/*; sem o desvio, o handler abaixo
// serviria essa pagina do cache e, pior, cairia em caches.match('./index.html')
// sem rede — entregando o shell do app do operador ao colaborador.
//
// Por que a origem separada e nao so o caminho: escopo de service worker e
// prefixo de caminho, mas IndexedDB, localStorage, Cache Storage e cookie sao
// por ORIGEM. Na mesma origem a pagina publica leria o banco 'efrat-ponto'
// (js/store.js), onde esta a credencial de 256 bits do aparelho. Caminho
// separado nunca foi fronteira contra isso.
const FORA_DO_APP = '/publico';

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
  if (url.pathname === FORA_DO_APP || url.pathname.startsWith(FORA_DO_APP + '/')) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
