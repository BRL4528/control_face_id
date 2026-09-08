// Helpers de request/response para as functions da Vercel (Node runtime).
// Padroniza CORS, corpo JSON e o formato de erro { ok:false, erro:{...} }.

const ORIGENS = (process.env.CORS_ORIGINS || '*');

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGENS);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, idempotency-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export function ok(res, dados, status = 200) {
  res.status(status).json(Object.assign({ ok: true }, dados));
}

export function erro(res, status, codigo, mensagem, detalhes) {
  const e = { codigo, mensagem };
  if (detalhes) e.detalhes = detalhes;
  res.status(status).json({ ok: false, erro: e });
}

/** Corpo JSON já vem parseado no runtime Node da Vercel; normaliza o resto. */
export function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

/** Só aceita o método esperado; devolve true se já respondeu erro. */
export function exigeMetodo(req, res, metodo) {
  if (req.method !== metodo) { erro(res, 405, 'METODO_INVALIDO', 'método não permitido'); return true; }
  return false;
}
