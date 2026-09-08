// Configurações da empresa: parâmetros anti-fraude, alarme de registro manual,
// jornada padrão, nome e fuso. Grava em config_empresa.dados (jsonb) + colunas de
// empresa. Só campos conhecidos entram — não é um saco de chave-valor livre.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

// Whitelist de parâmetros aceitos em config_empresa.dados, com coerção segura.
const num = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(n, hi)) : def;
};
function sanear(dados) {
  const d = dados || {};
  const out = {};
  if (d.limiarAceite != null) out.limiarAceite = num(d.limiarAceite, 0.2, 0.9, 0.45);
  if (d.limiarCinza != null) out.limiarCinza = num(d.limiarCinza, 0.3, 0.95, 0.58);
  if (d.raioPadraoM != null) out.raioPadraoM = num(d.raioPadraoM, 30, 5000, 200);
  if (d.toleranciaGpsM != null) out.toleranciaGpsM = num(d.toleranciaGpsM, 0, 500, 100);
  if (d.horaEntrada != null && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.horaEntrada)) out.horaEntrada = d.horaEntrada;
  if (d.alarmeManual != null) out.alarmeManual = num(d.alarmeManual, 1, 100, 20);
  if (d.jornadaPadrao != null) out.jornadaPadrao = String(d.jornadaPadrao).slice(0, 20);
  return out;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();

  // Dados da empresa (nome, fuso).
  const nome = b.empresa_nome != null ? String(b.empresa_nome).trim() : null;
  const fuso = b.fuso != null ? String(b.fuso).trim() : null;
  if (nome) await sql`UPDATE empresa SET nome=${nome} WHERE id=${rh.empresa_id}`;
  if (fuso) await sql`UPDATE empresa SET fuso=${fuso} WHERE id=${rh.empresa_id}`;

  // Parâmetros: merge sobre o que já existe (patch parcial).
  const patch = sanear(b.dados);
  if (Object.keys(patch).length) {
    const atual = await sql`SELECT dados FROM config_empresa WHERE empresa_id=${rh.empresa_id} LIMIT 1`;
    const base = (atual[0] && atual[0].dados) || {};
    const merged = Object.assign({}, base, patch);
    await sql`
      INSERT INTO config_empresa (empresa_id, dados, atualizada_em)
      VALUES (${rh.empresa_id}, ${JSON.stringify(merged)}, now())
      ON CONFLICT (empresa_id) DO UPDATE SET dados=EXCLUDED.dados, atualizada_em=now()`;
  }
  return ok(res, { salvo: true });
}
