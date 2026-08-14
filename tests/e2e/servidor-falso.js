// Servidor de teste: serve o app e finge os endpoints do n8n.
// Reproduz as regras que o servidor real aplica — idempotência por id_cliente,
// rejeição de colaborador inativo — para que o E2E valide o contrato, e não
// uma versão otimista dele.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.bin': 'application/octet-stream', '.css': 'text/css'
};

// Mesma semente do modo fingido em js/face.js — assim o descritor gerado no
// navegador casa exatamente com o template que a carga entrega.
export function vetorDe(semente) {
  const v = new Array(128).fill(0);
  const s = String(semente);
  for (let i = 0; i < 128; i++) v[i] = ((s.charCodeAt(i % s.length) * (i + 7)) % 100) / 100;
  return v;
}

export function criarServidor(opts = {}) {
  const estado = {
    token: opts.token || 'TOKEN-TESTE',
    marcacoes: new Map(),      // id_cliente -> marcação
    inativos: new Set(opts.inativos || []),
    fora: false,               // simula servidor inacessível
    chamadas: { carga: 0, marcacoes: 0, cadastro: 0 },
    lotesSimultaneos: 0,
    maxLotesSimultaneos: 0
  };

  const pessoas = (opts.pessoas || [
    { pessoa_id: 'p-ana', nome: 'Ana Souza', matricula: '001', equipe_id: 'eq-1', papel: 'colaborador' },
    { pessoa_id: 'p-bruno', nome: 'Bruno Lima', matricula: '002', equipe_id: 'eq-1', papel: 'colaborador' },
    { pessoa_id: 'p-carla', nome: 'Carla Dias', matricula: '003', equipe_id: 'eq-2', papel: 'colaborador' },
    { pessoa_id: 'p-gestor', nome: 'Gestor Piloto', matricula: 'G01', equipe_id: 'eq-1', papel: 'gestor' }
  ]).map(p => Object.assign({ versao: 1, vetores: [vetorDe(p.pessoa_id)], miniatura: '' }, p));

  function carga() {
    const fim = new Date(); fim.setHours(23, 59, 59, 0);
    return {
      ok: true,
      gestor: { id: 'p-gestor', nome: 'Gestor Piloto' },
      equipes: [
        { equipe_id: 'eq-1', nome: 'Equipe Um', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, minha: true },
        { equipe_id: 'eq-2', nome: 'Equipe Dois', unidade: 'Unidade A', lat: 0, lng: 0, raio_m: 500, minha: false }
      ],
      pessoas: pessoas.filter(p => !estado.inativos.has(p.pessoa_id)),
      sem_cadastro: [{ pessoa_id: 'p-novo', nome: 'Novato Sem Face', matricula: '009', equipe_id: 'eq-1' }],
      servidor_hora: new Date().toISOString(),
      expira_em: fim.toISOString()
    };
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const responder = (cod, obj) => {
      res.writeHead(cod, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname.startsWith('/webhook/')) {
      if (estado.fora) { res.destroy(); return; }
      let corpo = '';
      for await (const c of req) corpo += c;
      let body = {};
      try { body = corpo ? JSON.parse(corpo) : {}; } catch (e) { /* body vazio */ }

      const token = body.token || url.searchParams.get('token');
      if (token !== estado.token) return responder(401, { ok: false, erro: 'token invalido' });

      if (url.pathname === '/webhook/efrat/carga') {
        estado.chamadas.carga++;
        return responder(200, carga());
      }

      if (url.pathname === '/webhook/efrat/marcacoes') {
        estado.chamadas.marcacoes++;
        estado.lotesSimultaneos++;
        estado.maxLotesSimultaneos = Math.max(estado.maxLotesSimultaneos, estado.lotesSimultaneos);
        await new Promise(r => setTimeout(r, opts.latenciaMs || 60));
        const resultados = [];
        for (const m of (body.marcacoes || [])) {
          if (!m || !m.id_cliente || !m.pessoa_id || !m.marcado_em) {
            resultados.push({ id_cliente: m && m.id_cliente, status: 'rejeitado', motivo: 'campos obrigatorios ausentes' });
          } else if (estado.marcacoes.has(m.id_cliente)) {
            resultados.push({ id_cliente: m.id_cliente, status: 'duplicado', motivo: null });
          } else if (estado.inativos.has(m.pessoa_id) || !pessoas.some(p => p.pessoa_id === m.pessoa_id)) {
            resultados.push({ id_cliente: m.id_cliente, status: 'rejeitado', motivo: 'colaborador inativo ou inexistente' });
          } else {
            estado.marcacoes.set(m.id_cliente, m);
            resultados.push({ id_cliente: m.id_cliente, status: 'aceito', motivo: null });
          }
        }
        estado.lotesSimultaneos--;
        const conta = s => resultados.filter(x => x.status === s).length;
        return responder(200, {
          ok: true, servidor_hora: new Date().toISOString(),
          resumo: { aceitas: conta('aceito'), duplicadas: conta('duplicado'), rejeitadas: conta('rejeitado') },
          resultados
        });
      }

      if (url.pathname === '/webhook/efrat/cadastro') {
        estado.chamadas.cadastro++;
        const origem = body.origem === 'gestor' ? 'gestor' : 'rh';
        if (!Array.isArray(body.vetores) || !body.vetores.length) {
          return responder(422, { ok: false, erro: 'vetores vazios' });
        }
        const id = 'p-' + (body.matricula || Math.random().toString(36).slice(2));
        if (origem === 'rh' && !pessoas.some(p => p.pessoa_id === id)) {
          pessoas.push({
            pessoa_id: id, nome: body.nome, matricula: body.matricula,
            equipe_id: body.equipe_id, papel: 'colaborador', versao: 1,
            vetores: body.vetores, miniatura: body.miniatura || ''
          });
        }
        return responder(200, {
          ok: true, pessoa_id: id, template_id: 't-' + id, versao: 1,
          status: origem === 'rh' ? 'ativo' : 'pendente'
        });
      }
      return responder(404, { ok: false, erro: 'rota desconhecida' });
    }

    // estáticos
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const arq = path.join(RAIZ, decodeURIComponent(p));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
      res.writeHead(404); res.end('nao encontrado'); return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });

  return { servidor, estado, pessoas, carga };
}

export function subir(opts = {}) {
  const { servidor, estado, pessoas } = criarServidor(opts);
  return new Promise(res => {
    servidor.listen(0, '127.0.0.1', () => {
      res({ url: 'http://127.0.0.1:' + servidor.address().port, servidor, estado, pessoas });
    });
  });
}
