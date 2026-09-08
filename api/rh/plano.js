// Escala recorrente (plano) de uma equipe. O RH define uma vez (equipe → cerca,
// dias da semana, vigência) e nós MATERIALIZAMOS em linhas `alocacao` reais para
// os dias úteis (ver api/_lib/escala.js). O app do colaborador, que lê `alocacao`
// por dia ao bater ponto, não muda em nada.
//
//   • acao 'salvar' (default): upsert do plano + recria as alocações FUTURAS dele
//     (origem='plano'), sem tocar no passado nem em ajustes manuais (origem='manual').
//     Uma pessoa só pode estar em UMA escala por dia: se algum colaborador já está
//     em outro plano ativo que cruza dias da semana e vigência, devolve 409 CONFLITO
//     com quem/onde. Com `forcar: true`, tira essas pessoas do outro plano e segue.
//     Sem isso o último plano salvo roubava os dias do anterior em silêncio.
//   • acao 'remover': soft delete (ativo=false) + limpa alocações futuras do plano.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { materializarPlano, normalizarPlano } from '../_lib/escala.js';

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
    // Confere que o plano é desta empresa ANTES de apagar alocações (isolamento de tenant).
    const dono = await sql`SELECT id FROM plano_alocacao WHERE id=${b.plano_id} AND empresa_id=${rh.empresa_id} LIMIT 1`;
    if (!dono[0]) return erro(res, 404, 'PLANO_NAO_ENCONTRADO', 'escala não encontrada');
    await sql`DELETE FROM alocacao WHERE plano_id=${b.plano_id} AND empresa_id=${rh.empresa_id} AND dia >= ${hoje} AND origem='plano'`;
    await sql`UPDATE plano_alocacao SET ativo=false, atualizado_em=now() WHERE id=${b.plano_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { removido: true });
  }

  // ---- salvar (upsert) + materializar ----
  const equipeId = b.equipe_id;
  const nome = String(b.nome || '').trim().slice(0, 80) || null;   // projeto/obra; opcional
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

  // Outros planos ativos da empresa que disputam as mesmas pessoas nos mesmos
  // dias da semana, com vigências que se cruzam.
  const conflitos = colaboradores.length ? await sql`
    SELECT id AS plano_id, nome, equipe_id, dias_semana,
           to_char(vigencia_inicio,'YYYY-MM-DD') AS vigencia_inicio, to_char(vigencia_fim,'YYYY-MM-DD') AS vigencia_fim,
           ARRAY(SELECT unnest(colaboradores) INTERSECT SELECT unnest(${colaboradores}::text[])) AS em_comum
    FROM plano_alocacao
    WHERE empresa_id=${rh.empresa_id} AND ativo=true AND id<>${planoId}
      AND colaboradores && ${colaboradores}::text[]
      AND dias_semana && ${diasSemana}::int[]
      AND vigencia_inicio <= COALESCE(${vigFim}::date, 'infinity'::date)
      AND COALESCE(vigencia_fim, 'infinity'::date) >= ${vigInicio}::date` : [];

  if (conflitos.length && !b.forcar) {
    return erro(res, 409, 'CONFLITO', 'colaborador já está em outra escala nesses dias', { conflitos });
  }

  // forcar: tira as pessoas em comum dos outros planos e regrava o futuro deles.
  for (const c of conflitos) {
    const rows = await sql`
      UPDATE plano_alocacao
      SET colaboradores = ARRAY(SELECT unnest(colaboradores) EXCEPT SELECT unnest(${c.em_comum}::text[])),
          atualizado_em = now()
      WHERE id=${c.plano_id} AND empresa_id=${rh.empresa_id}
      RETURNING *`;
    if (rows[0]) await materializarPlano(sql, normalizarPlano(rows[0]), hoje, { recriar: true });
  }

  const [plano] = await sql`
    INSERT INTO plano_alocacao (id, empresa_id, nome, equipe_id, colaboradores, cerca_lat, cerca_lng, cerca_raio_m,
                                dias_semana, vigencia_inicio, vigencia_fim, ativo, atualizado_em)
    VALUES (${planoId}, ${rh.empresa_id}, ${nome}, ${equipeId}, ${colaboradores}, ${cerca.lat}, ${cerca.lng}, ${raio},
            ${diasSemana}, ${vigInicio}, ${vigFim}, ${true}, now())
    ON CONFLICT (id) DO UPDATE SET
      nome=EXCLUDED.nome, equipe_id=EXCLUDED.equipe_id, colaboradores=EXCLUDED.colaboradores,
      cerca_lat=EXCLUDED.cerca_lat, cerca_lng=EXCLUDED.cerca_lng, cerca_raio_m=EXCLUDED.cerca_raio_m,
      dias_semana=EXCLUDED.dias_semana, vigencia_inicio=EXCLUDED.vigencia_inicio,
      vigencia_fim=EXCLUDED.vigencia_fim, ativo=true, atualizado_em=now()
    RETURNING *`;

  const r = await materializarPlano(sql, normalizarPlano(plano), hoje, { recriar: true });
  return ok(res, { plano_id: planoId, dias_materializados: r.dias, alocacoes_gravadas: r.gravadas, planos_ajustados: conflitos.length });
}
