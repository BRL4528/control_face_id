// Alocação diária + cerca virtual — a operação que o RH faz todo dia.
//
// Recebe UM dia e uma lista de alocações; cada uma diz qual colaborador, em qual
// equipe e onde (cerca: lat, lng, raio). Idempotente por (empresa, dia,
// colaborador): realocar alguém é sobrescrever a linha do dia dele — é o que
// permite "arrastar o pin e salvar" sem duplicar.
//
// Como o RH normalmente aloca a equipe inteira no mesmo ponto, o cliente manda a
// cerca uma vez e a lista de colaboradores; expandimos aqui. Também aceita cerca
// por item, para o caso de gente no mesmo dia em locais diferentes.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const dia = String(b.dia || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const equipeId = b.equipe_id;
  const cercaBase = b.cerca || {};
  const sql = db();

  // Remover a alocação de uma equipe num dia (o card "Remover alocação").
  if (b.acao === 'remover') {
    if (!equipeId) return erro(res, 400, 'CORPO_INVALIDO', 'equipe_id obrigatório');
    const del = await sql`
      DELETE FROM alocacao
      WHERE empresa_id=${rh.empresa_id} AND dia=${dia} AND equipe_id=${equipeId}
      RETURNING id`;
    return ok(res, { dia, removidas: del.length });
  }

  const itens = Array.isArray(b.colaboradores) ? b.colaboradores : [];
  if (!itens.length) return erro(res, 400, 'CORPO_INVALIDO', 'nenhum colaborador para alocar');
  let gravadas = 0;
  for (const it of itens) {
    // Cada item pode ser só o id (usa a cerca base) ou um objeto com cerca própria.
    const colaboradorId = typeof it === 'string' ? it : it.colaborador_id;
    if (!colaboradorId) continue;
    const cerca = (typeof it === 'object' && it.cerca) ? it.cerca : cercaBase;
    const eq = (typeof it === 'object' && it.equipe_id) || equipeId;
    if (cerca.lat == null || cerca.lng == null || !eq) continue;

    // origem='manual': é ajuste pontual do RH. A re-materialização de um plano
    // NÃO sobrescreve linhas manuais (ver api/rh/plano.js), então este dia fica
    // "cravado" mesmo que um plano cubra a mesma data.
    await sql`
      INSERT INTO alocacao (id, empresa_id, dia, colaborador_id, equipe_id, cerca_lat, cerca_lng, cerca_raio_m, origem, plano_id)
      VALUES (${novoId()}, ${rh.empresa_id}, ${dia}, ${colaboradorId}, ${eq},
              ${cerca.lat}, ${cerca.lng}, ${Number(cerca.raio_m) || 200}, 'manual', ${null})
      ON CONFLICT (empresa_id, dia, colaborador_id) DO UPDATE SET
        equipe_id = EXCLUDED.equipe_id, cerca_lat = EXCLUDED.cerca_lat,
        cerca_lng = EXCLUDED.cerca_lng, cerca_raio_m = EXCLUDED.cerca_raio_m,
        origem = 'manual', plano_id = NULL`;
    gravadas++;
  }
  return ok(res, { dia, gravadas });
}
