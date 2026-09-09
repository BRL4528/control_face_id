// Servidor local sem `vercel dev` (o script "dev" é recursivo e o CLI recusa).
// Serve os estáticos da raiz e roteia /api/<rota> para import('api/<rota>.js'),
// com req.query/req.body e res.status().json() como no runtime Node da Vercel.
// /e/<token> cai em index.html (mesmo rewrite do vercel.json). O módulo da rota
// é reimportado a cada request (cache-bust), então editar api/*.js não exige
// reiniciar — só as dependências (_lib) ficam em cache.
//
//   node --env-file=.env.local scripts/dev-local.js [porta]     (default 4300)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const porta = Number(process.argv[2] || process.env.PORT || 4300);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

async function existe(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

function lerCorpo(req) {
  return new Promise(resolve => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8');
      const ct = String(req.headers['content-type'] || '');
      if (!txt) return resolve({});
      if (ct.includes('application/json')) { try { return resolve(JSON.parse(txt)); } catch { return resolve({}); } }
      resolve(txt);
    });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  res.send = b => res.end(b);
  try {
    if (url.pathname.startsWith('/api/')) {
      const rota = normalize(url.pathname.slice(5)).replace(/^(\.\.[/\\])+/, '');
      const arquivo = join(raiz, 'api', rota + '.js');
      if (!rota || rota.startsWith('_lib') || !(await existe(arquivo))) return res.status(404).json({ ok: false, erro: { codigo: 'ROTA', mensagem: 'rota não encontrada' } });
      req.query = Object.fromEntries(url.searchParams);
      req.body = await lerCorpo(req);
      const mod = await import(pathToFileURL(arquivo).href + '?t=' + Date.now());
      return await mod.default(req, res);
    }
    let caminho = url.pathname === '/' || url.pathname.startsWith('/e/') ? '/index.html' : decodeURIComponent(url.pathname);
    caminho = normalize(caminho).replace(/^(\.\.[/\\])+/, '');
    const arquivo = join(raiz, caminho);
    if (!arquivo.startsWith(raiz) || !(await existe(arquivo))) { res.status(404).end('não encontrado'); return; }
    res.setHeader('Content-Type', MIME[extname(arquivo)] || 'application/octet-stream');
    res.end(await readFile(arquivo));
  } catch (e) {
    console.error(req.method, url.pathname, e);
    if (!res.headersSent) res.status(500).json({ ok: false, erro: { codigo: 'INTERNO', mensagem: e.message } });
  }
}).listen(porta, () => console.log('control-face-id local: http://localhost:' + porta));
