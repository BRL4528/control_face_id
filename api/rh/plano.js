// Planejamento recorrente de alocação. O RH define um plano (equipe → cerca,
// dias da semana, vigência) e nós MATERIALIZAMOS em linhas `alocacao` reais para
// os dias úteis dentro da vigência (até um horizonte). Assim o app do colaborador,
// que lê `alocacao` por dia ao bater ponto, não muda em nada.
//
//   • acao 'salvar' (default): upsert do plano + recria as alocações FUTURAS dele
//     (origem='plano'), sem tocar no passado nem em ajustes manuais (origem='manual').
//   • acao 'remover': soft delete (ativo=false) + limpa alocações futuras do plano.
//
// Materialização em UM único INSERT via unnest(): o driver HTTP do Neon roda um
// comando por chamada, então um loop de INSERT por dia×pessoa estouraria em
// round-trips. unnest expande o produto num só statement.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const HORIZONTE_DIAS = 90;   // teto para planos indefinidos
const UM_DIA_MS = 86400000;

// Mesma regra pura de js/regras.js::materializarDias, embutida para o endpoint
// não depender de um módulo do cliente (bundling serverless).
function isoDia(ms) { return new Date(ms).toISOString().slice(0, 10); }
function isoWeekday(diaISO) {
  const d = new Date(diaISO + 'T12:00:00Z').getUTCDay();   // 0=dom … 6=sáb
  return d === 0 ? 7 : d;
}
function materializarDias(plano, hoje, horizonteDias) {
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

const HORA_DIA = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const sql = db();
  const hoje = new Date().toISOString().slice(0, 10);

  // ---- remover (soft) ----
  if (b.acao === 'remover') {
    if (!b.plano_id) return erro(res, 400, 'CORPO_INVALIDO', 'plano_id obrigatório');
    await sql`DELETE FROM alocacao WHERE plano_id=${b.plano_id} AND dia >= ${hoje} AND origem='plano'`;
    await sql`UPDATE plano_alocacao SET ativo=false, atualizado_em=now() WHERE id=${b.plano_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { removido: true });
  }

  // ---- salvar (upsert) + materializar ----
  const equipeId = b.equipe_id;
  const cerca = b.cerca || {};
  const colaboradores = Array.isArray(b.colaboradores) ? b.colaboradores.filter(Boolean) : [];
  const diasSemana = Array.isArray(b.dias_semana) && b.dias_semana.length
    ? b.dias_semana.map(Number).filter(n => n >= 1 && n <= 7) : [1, 2, 3, 4, 5];
  const vigInicio = HORA_DIA.test(b.vigencia_inicio) ? b.vigencia_inicio : hoje;
  const vigFim = HORA_DIA.test(b.vigencia_fim) ? b.vigencia_fim : null;

  if (!equipeId) return erro(res, 400, 'CORPO_INVALIDO', 'equipe_id obrigatório');
  if (cerca.lat == null || cerca.lng == null) return erro(res, 400, 'CORPO_INVALIDO', 'cerca (lat/lng) obrigatória');
  if (vigFim && vigFim < vigInicio) return erro(res, 400, 'CORPO_INVALIDO', 'fim da vigência antes do início');

  const raio = Math.max(30, Math.min(Number(cerca.raio_m) || 200, 5000));
  const planoId = b.plano_id || novoId();

  await sql`
    INSERT INTO plano_alocacao (id, empresa_id, equipe_id, colaboradores, cerca_lat, cerca_lng, cerca_raio_m,
                                dias_semana, vigencia_inicio, vigencia_fim, ativo, atualizado_em)
    VALUES (${planoId}, ${rh.empresa_id}, ${equipeId}, ${colaboradores}, ${cerca.lat}, ${cerca.lng}, ${raio},
            ${diasSemana}, ${vigInicio}, ${vigFim}, ${true}, now())
    ON CONFLICT (id) DO UPDATE SET
      equipe_id=EXCLUDED.equipe_id, colaboradores=EXCLUDED.colaboradores,
      cerca_lat=EXCLUDED.cerca_lat, cerca_lng=EXCLUDED.cerca_lng, cerca_raio_m=EXCLUDED.cerca_raio_m,
      dias_semana=EXCLUDED.dias_semana, vigencia_inicio=EXCLUDED.vigencia_inicio,
      vigencia_fim=EXCLUDED.vigencia_fim, ativo=true, atualizado_em=now()`;

  // Recria as alocações FUTURAS geradas por este plano (não toca no passado nem no manual).
  await sql`DELETE FROM alocacao WHERE plano_id=${planoId} AND dia >= ${hoje} AND origem='plano'`;

  const dias = materializarDias(
    { dias_semana: diasSemana, vigencia_inicio: vigInicio, vigencia_fim: vigFim }, hoje, HORIZONTE_DIAS);

  let gravadas = 0;
  if (dias.length && colaboradores.length) {
    // Produto dias × colaboradores em 3 arrays paralelos. Fatiar em lotes de 1000
    // tuplas para não passar de um payload grande demais por chamada.
    const ids = [], diasCol = [], colabs = [];
    for (const d of dias) for (const c of colaboradores) { ids.push(novoId()); diasCol.push(d); colabs.push(c); }

    const LOTE = 1000;
    for (let i = 0; i < ids.length; i += LOTE) {
      const fi = ids.slice(i, i + LOTE), fd = diasCol.slice(i, i + LOTE), fc = colabs.slice(i, i + LOTE);
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
        [rh.empresa_id, equipeId, cerca.lat, cerca.lng, raio, planoId, fi, fd, fc]);
      gravadas += (r.rows ? r.rows.length : (Array.isArray(r) ? r.length : 0));
    }
  }

  return ok(res, { plano_id: planoId, dias_materializados: dias.length, alocacoes_gravadas: gravadas });
}
