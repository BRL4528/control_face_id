// Materialização de um plano (escala) em linhas `alocacao`: a regra "equipe →
// cerca, dias da semana, vigência" vira uma linha real por dia × colaborador,
// que é o que o app do colaborador lê ao bater ponto. Compartilhado por
// /rh/plano (salvar) e /cron/renovar-escala (estender o horizonte todo dia).
//
// Um único INSERT via unnest(): o driver HTTP do Neon roda um comando por
// chamada, então um loop de INSERT por dia×pessoa estouraria em round-trips.
import { novoId } from './db.js';

export const HORIZONTE_DIAS = 90;   // teto de dias gerados à frente para plano sem prazo
const UM_DIA_MS = 86400000;
const LOTE = 1000;

// Mesma regra pura de js/regras.js::materializarDias, embutida para o endpoint
// não depender de um módulo do cliente (bundling serverless).
export function isoDia(ms) { return new Date(ms).toISOString().slice(0, 10); }
function isoWeekday(diaISO) {
  const d = new Date(diaISO + 'T12:00:00Z').getUTCDay();   // 0=dom … 6=sáb
  return d === 0 ? 7 : d;
}
export function materializarDias(plano, hoje, horizonteDias) {
  const diasSem = new Set((plano.dias_semana && plano.dias_semana.length ? plano.dias_semana : [1, 2, 3, 4, 5]).map(Number));
  const hojeMs = Date.parse(hoje + 'T00:00:00Z');
  const horizonteMs = hojeMs + Math.max(1, horizonteDias) * UM_DIA_MS;
  const inicioMs = Math.max(hojeMs, Date.parse(plano.vigencia_inicio + 'T00:00:00Z'));
  const fimMs = Math.min(horizonteMs, plano.vigencia_fim ? Date.parse(plano.vigencia_fim + 'T00:00:00Z') : horizonteMs);
  const out = [];
  for (let ms = inicioMs; ms <= fimMs; ms += UM_DIA_MS) {
    const d = isoDia(ms);
    if (diasSem.has(isoWeekday(d))) out.push(d);
  }
  return out;
}

/**
 * Grava as alocações futuras de um plano (linha de plano_alocacao, datas como
 * 'YYYY-MM-DD'). Com `recriar`, apaga antes as linhas futuras origem='plano'
 * dele (edição: dias/pessoas podem ter saído). Sem `recriar`, só completa o
 * que falta (renovação diária). Nunca toca em ajustes manuais nem no passado.
 * Devolve { dias, gravadas }.
 */
export async function materializarPlano(sql, plano, hoje, { recriar = false } = {}) {
  if (recriar) await sql`DELETE FROM alocacao WHERE plano_id=${plano.id} AND dia >= ${hoje} AND origem='plano'`;

  const dias = materializarDias(plano, hoje, HORIZONTE_DIAS);
  const colaboradores = (plano.colaboradores || []).filter(Boolean);
  let gravadas = 0;
  if (dias.length && colaboradores.length) {
    const ids = [], diasCol = [], colabs = [];
    for (const d of dias) for (const c of colaboradores) { ids.push(novoId()); diasCol.push(d); colabs.push(c); }
    for (let i = 0; i < ids.length; i += LOTE) {
      const r = await sql.query(
        `INSERT INTO alocacao (id, empresa_id, dia, colaborador_id, equipe_id,
                               cerca_lat, cerca_lng, cerca_raio_m, origem, plano_id)
         SELECT t.id, $1, t.dia::date, t.colab, $2, $3, $4, $5, 'plano', $6
         FROM unnest($7::text[], $8::text[], $9::text[]) AS t(id, dia, colab)
         ON CONFLICT (empresa_id, dia, colaborador_id) DO UPDATE SET
           equipe_id=EXCLUDED.equipe_id, cerca_lat=EXCLUDED.cerca_lat, cerca_lng=EXCLUDED.cerca_lng,
           cerca_raio_m=EXCLUDED.cerca_raio_m, origem=EXCLUDED.origem, plano_id=EXCLUDED.plano_id
         WHERE alocacao.origem <> 'manual'
         RETURNING 1`,
        [plano.empresa_id, plano.equipe_id, plano.cerca_lat, plano.cerca_lng, plano.cerca_raio_m, plano.id,
         ids.slice(i, i + LOTE), diasCol.slice(i, i + LOTE), colabs.slice(i, i + LOTE)]);
      gravadas += (r.rows ? r.rows.length : (Array.isArray(r) ? r.length : 0));
    }
  }
  return { dias: dias.length, gravadas };
}

// O driver devolve colunas DATE como Date (meia-noite LOCAL). Formatar com os
// getters locais preserva o dia; toISOString() poderia voltar um dia em fusos > UTC.
function diaISO(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    const mm = String(v.getMonth() + 1).padStart(2, '0'), dd = String(v.getDate()).padStart(2, '0');
    return v.getFullYear() + '-' + mm + '-' + dd;
  }
  return String(v).slice(0, 10);
}

/** Linhas de plano_alocacao com datas normalizadas para 'YYYY-MM-DD'. */
export function normalizarPlano(p) {
  return Object.assign({}, p, { vigencia_inicio: diaISO(p.vigencia_inicio), vigencia_fim: diaISO(p.vigencia_fim) });
}
