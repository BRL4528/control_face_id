// Resolve o link da empresa (/e/<token>) para { id, nome }. Público: o token é
// o segredo (aleatório, regenerável em Configurações). Só devolve o necessário
// para o app se posicionar na empresa — nada de colaboradores.
import { db } from './_lib/db.js';
import { cors, ok, erro } from './_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return erro(res, 405, 'METODO_INVALIDO', 'método não permitido');
  const t = String((req.query && req.query.t) || '').trim().toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(t)) return erro(res, 400, 'CORPO_INVALIDO', 'token inválido');
  const r = await db()`SELECT id, nome FROM empresa WHERE link_token = ${t} LIMIT 1`;
  if (!r[0]) return erro(res, 404, 'LINK_INVALIDO', 'este link não é mais válido. Peça o link atual ao RH.');
  res.setHeader('Cache-Control', 'no-store');
  return ok(res, { empresa: { id: r[0].id, nome: r[0].nome, token: t } });
}
