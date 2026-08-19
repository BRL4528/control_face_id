// Guardas contra erros que só aparecem depois do deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ler = p => fs.readFileSync(path.join(RAIZ, p), 'utf8');

test('todo arquivo listado no service worker existe', () => {
  const sw = ler('sw.js');
  const lista = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]).filter(a => a !== './');
  assert.ok(lista.length > 5, 'lista de assets suspeita de vazia');
  for (const a of lista) {
    assert.ok(fs.existsSync(path.join(RAIZ, a)), 'sw.js aponta para arquivo inexistente: ' + a);
  }
});

test('todo script referenciado no index existe', () => {
  const html = ler('index.html');
  const srcs = [...html.matchAll(/src="(\.\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(srcs.includes('./js/app.js'));
  for (const s of srcs) {
    assert.ok(fs.existsSync(path.join(RAIZ, s)), 'index.html aponta para arquivo inexistente: ' + s);
  }
});

test('todo modulo importado pelo app existe', () => {
  const arquivos = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'));
  for (const f of arquivos) {
    const src = ler('js/' + f);
    for (const m of src.matchAll(/from\s+'(\.\/[^']+)'/g)) {
      assert.ok(fs.existsSync(path.join(RAIZ, 'js', m[1])), f + ' importa ' + m[1] + ' que nao existe');
    }
  }
});

test('os modelos do face-api estao no repositorio', () => {
  for (const m of ['tiny_face_detector', 'face_landmark_68', 'face_recognition']) {
    assert.ok(fs.existsSync(path.join(RAIZ, 'models', m + '_model.bin')), 'falta o peso de ' + m);
    assert.ok(fs.existsSync(path.join(RAIZ, 'models', m + '_model-weights_manifest.json')), 'falta o manifesto de ' + m);
  }
});

test('o manifesto do PWA aponta para icones que existem', () => {
  const man = JSON.parse(ler('manifest.json'));
  for (const i of man.icons) {
    assert.ok(fs.existsSync(path.join(RAIZ, i.src.replace('./', ''))), 'icone ausente: ' + i.src);
  }
});

test('nenhum token de verdade foi commitado na configuracao', () => {
  const cfg = ler('js/config.js');
  assert.ok(!/token\s*:/i.test(cfg), 'config.js nao pode conter token — ele vira publico no bundle');
});

test('o service worker nao intercepta chamadas de outra origem', () => {
  const sw = ler('sw.js');
  assert.match(sw, /url\.origin\s*!==\s*location\.origin/,
    'sem esse guarda, resposta de marcacao pode ser servida do cache');
});

test('todo modulo de js/ esta no cache do service worker', () => {
  // Modulo fora da lista funciona online e some no primeiro uso offline —
  // exatamente o cenario do gestor no campo sem sinal.
  const sw = ler('sw.js');
  for (const f of fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js'))) {
    assert.ok(sw.includes("'./js/" + f + "'"), 'js/' + f + ' nao esta em ASSETS do sw.js');
  }
});

test('as cinco telas do fluxo existem no index', () => {
  const html = ler('index.html');
  for (const id of ['porta', 'aguardando', 'fila', 'rh', 'loginRh']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'falta a secao #' + id);
  }
});

test('o codigo de aprovacao pendente nao vaza fora do elemento visivel', () => {
  // Critério de aceite da tela do colaborador (docs/plano-v3.md, item 3):
  // sem console.log, sem querystring, sem atributo fora do elemento visível.
  for (const f of ['js/app.js']) {
    const src = ler(f);
    assert.ok(!/console\.\w+\([^)]*codigo/i.test(src), f + ' loga o codigo curto — nao pode');
  }
});

test('a versao do cache do sw acompanha o conjunto de arquivos', () => {
  const sw = ler('sw.js');
  assert.match(sw, /const CACHE = 'efrat-ponto-v\d+'/, 'sw.js precisa de versao de cache explicita');
});

test('as fontes auto-hospedadas estao no repositorio e no css de fontes', () => {
  const css = ler('css/fontes.css');
  assert.ok(!/fonts\.googleapis\.com/i.test(css), 'css/fontes.css nao pode carregar do Google Fonts');
  assert.ok(!/fonts\.gstatic\.com/i.test(css), 'css/fontes.css nao pode carregar do gstatic');
  
  const fontes = [...css.matchAll(/url\(['"]?(\.\.\/vendor\/fontes\/[^'")]+)['"]?\)/g)].map(m => m[1]);
  assert.ok(fontes.length >= 8, 'esperado conjunto de fontes woff2');
  for (const f of fontes) {
    const rel = f.replace('../', '');
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), 'fonte inexistente no disco: ' + rel);
  }
});

test('chart.js esta auto-hospedado em vendor e configurado localmente', () => {
  const cfg = ler('js/config.js');
  assert.ok(!/cdn\.jsdelivr\.net/i.test(cfg), 'config.js nao pode apontar chartCdn para CDN externa');
  assert.ok(fs.existsSync(path.join(RAIZ, 'vendor/chart.umd.min.js')), 'falta o vendor/chart.umd.min.js');
});

test('a politica de CSP fecha terceiros e protege contra vazamentos', () => {
  const headers = ler('_headers');
  const vercel = JSON.parse(ler('vercel.json'));
  
  assert.match(headers, /Content-Security-Policy:/, '_headers precisa conter Content-Security-Policy');
  assert.match(headers, /font-src\s+'self'/, 'font-src deve ser fechado para self');
  assert.match(headers, /script-src\s+'self'/, 'script-src deve ser fechado para self');
  
  const vHeaders = vercel.headers.find(h => h.source === '/(.*)');
  assert.ok(vHeaders, 'vercel.json deve configurar headers globais');
  const csp = vHeaders.headers.find(h => h.key === 'Content-Security-Policy');
  assert.ok(csp, 'vercel.json deve conter Content-Security-Policy');
  assert.match(csp.value, /font-src\s+'self'/, 'CSP da Vercel deve fechar font-src para self');
});

test('a CSP do servidor de testes e2e e da Vercel sao identicas a do _headers', async () => {
  const { extrairCspDeHeaders } = await import('../e2e/servidor-falso.js');
  const headers = ler('_headers');
  const matchHeader = headers.match(/Content-Security-Policy:\s*(.+)/);
  const cspHeader = matchHeader ? matchHeader[1].trim() : '';

  const cspTestServer = extrairCspDeHeaders();
  assert.equal(cspTestServer, cspHeader, 'a CSP do servidor de testes deve ser identica a do _headers');

  const vercel = JSON.parse(ler('vercel.json'));
  const vHeaders = vercel.headers.find(h => h.source === '/(.*)');
  const cspVercel = vHeaders.headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.equal(cspVercel, cspHeader, 'a CSP do vercel.json deve ser identica a do _headers');
});

// Guardas de integração e integridade de ativos (T-5A062C)

test('guarda 1: todo href ou src local no HTML aponta para arquivo existente', () => {
  const html = ler('index.html');
  const links = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m => m[1]);
  for (const l of links) {
    if (l.startsWith('http://') || l.startsWith('https://') || l.startsWith('data:') || l.startsWith('#') || l.startsWith('mailto:')) {
      continue;
    }
    const limpo = l.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(RAIZ, limpo)), `index.html aponta para arquivo local inexistente em href/src: ${l}`);
  }
});

test('guarda 2: toda url() em @font-face nos arquivos CSS resolve para arquivo existente', () => {
  const pastaCss = path.join(RAIZ, 'css');
  if (!fs.existsSync(pastaCss)) return;
  const arquivosCss = fs.readdirSync(pastaCss).filter(f => f.endsWith('.css'));
  for (const f of arquivosCss) {
    const css = ler(path.join('css', f));
    const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(m => m[1]);
    for (const u of urls) {
      if (u.startsWith('data:') || u.startsWith('http://') || u.startsWith('https://')) continue;
      const caminhoAbs = path.resolve(path.join(RAIZ, 'css'), u);
      assert.ok(fs.existsSync(caminhoAbs), `css/${f} referencia url() inexistente: ${u}`);
    }
  }
});

test('guarda 3: todo arquivo CSS em css/ esta linkado em pelo menos um HTML', () => {
  const pastaCss = path.join(RAIZ, 'css');
  assert.ok(fs.existsSync(pastaCss), 'pasta css/ deve existir');
  const arquivosCss = fs.readdirSync(pastaCss).filter(f => f.endsWith('.css'));
  const html = ler('index.html');
  for (const f of arquivosCss) {
    const ehLinkado = html.includes(`css/${f}`) || html.includes(`./css/${f}`);
    assert.ok(ehLinkado, `o arquivo css/${f} nao esta linkado em index.html`);
  }
});

test('guarda 4: nenhum JS ou CSS carrega dominios externos fora do apiBase ou CDNs', () => {
  const dominiosProibidos = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  const verificarTexto = (txt, local) => {
    for (const d of dominiosProibidos) {
      assert.ok(!txt.includes(d), `${local} contem referencia a CDN/dominio externo proibido: ${d}`);
    }
  };
  verificarTexto(ler('js/config.js'), 'js/config.js');
  verificarTexto(ler('sw.js'), 'sw.js');
  if (fs.existsSync(path.join(RAIZ, 'css/fontes.css'))) {
    verificarTexto(ler('css/fontes.css'), 'css/fontes.css');
  }
});

test('guarda 5: nenhum token de verdade ou segredo foi commitado em js/, css/, sw.js ou index.html', () => {
  const padraoSegredo = /(?:token|secret|password|bearer|api_key)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/i;
  const verificarSegredo = (caminhoRel) => {
    const txt = ler(caminhoRel);
    assert.ok(!padraoSegredo.test(txt), `${caminhoRel} contem padrao suspeito de token/segredo commitado`);
  };

  verificarSegredo('js/config.js');
  verificarSegredo('sw.js');
  verificarSegredo('index.html');
  if (fs.existsSync(path.join(RAIZ, 'css/fontes.css'))) {
    verificarSegredo('css/fontes.css');
  }
});

test('guarda 6: todo arquivo local referenciado no index.html deve estar no precache do sw.js', () => {
  const html = ler('index.html');
  const sw = ler('sw.js');
  const assetsSw = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]);
  const links = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m => m[1]);
  
  // Lista de exceções legítimas não-cacheadas por Service Worker (se houver no futuro)
  const excecoesLegitimas = new Set([]);

  for (const l of links) {
    if (l.startsWith('http://') || l.startsWith('https://') || l.startsWith('data:') || l.startsWith('#') || l.startsWith('mailto:')) {
      continue;
    }
    if (excecoesLegitimas.has(l)) continue;

    const padronizado = l.startsWith('./') ? l : `./${l}`;
    assert.ok(
      assetsSw.includes(padronizado),
      `recurso ${l} linkado em index.html nao esta presente na lista ASSETS do sw.js`
    );
  }
});

test('guarda 7: o conjunto de arquivos em vendor/fontes/ e exatamente o referenciado por css/fontes.css (bidirecional)', () => {
  const pastaFontes = path.join(RAIZ, 'vendor/fontes');
  assert.ok(fs.existsSync(pastaFontes), 'pasta vendor/fontes deve existir');
  
  const arquivosNoDisco = fs.readdirSync(pastaFontes).filter(f => !f.startsWith('.'));
  const css = ler('css/fontes.css');
  const fontesReferenciadasNoCss = [...css.matchAll(/url\(['"]?(\.\.\/vendor\/fontes\/[^'")]+)['"]?\)/g)]
    .map(m => path.basename(m[1]));
  
  const setReferenciadas = new Set(fontesReferenciadasNoCss);
  const orfaos = arquivosNoDisco.filter(f => !setReferenciadas.has(f));

  assert.equal(
    orfaos.length,
    0,
    `arquivos orfaos em vendor/fontes/: ${orfaos.join(', ')} — arquivo nao referenciado por nenhum @font-face — sobra de copia entre branches?`
  );

  // Validação complementar em vendor/ direto (ex: chart.umd.min.js, face-api.js)
  const pastaVendor = path.join(RAIZ, 'vendor');
  const arquivosVendorDiretos = fs.readdirSync(pastaVendor)
    .filter(f => fs.statSync(path.join(pastaVendor, f)).isFile() && !f.startsWith('.'));
  
  const html = ler('index.html');
  const sw = ler('sw.js');
  const cfg = ler('js/config.js');
  
  for (const f of arquivosVendorDiretos) {
    const ehReferenciado = html.includes(f) || sw.includes(f) || cfg.includes(f);
    assert.ok(ehReferenciado, `arquivo vendor/${f} nao esta referenciado em index.html, sw.js ou js/config.js`);
  }
});





