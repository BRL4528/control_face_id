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
import { exigeAcesso } from '../_lib/acesso.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { diaValido, foraDaEmpresa } from '../_lib/validar.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const dia = b.dia ? String(b.dia) : new Date().toISOString().slice(0, 10);
  if (!diaValido(dia)) return erro(res, 400, 'CORPO_INVALIDO', 'dia inválido');
  const equipeId = b.equipe_id ? String(b.equipe_id) : null;
  const cercaBase = b.cerca || {};
  const sql = db();
  if (!(await exigeAcesso(res, sql, rh, 'operacao', true))) return;

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

  // Cada item pode ser só o id (usa a cerca base) ou um objeto com cerca própria.
  const linhas = [];
  for (const it of itens) {
    if (!it) continue;
    const colaboradorId = typeof it === 'string' ? it : it.colaborador_id;
    if (!colaboradorId) continue;
    const cerca = (typeof it === 'object' && it.cerca) ? it.cerca : cercaBase;
    const eq = (typeof it === 'object' && it.equipe_id) || equipeId;
    if (cerca.lat == null || cerca.lng == null || !eq) continue;
    linhas.push({ colaboradorId: String(colaboradorId), eq: String(eq), cerca });
  }

  // Isolamento de tenant: pessoas e equipes (inclusive as por item) têm de ser
  // desta empresa, senão o app da outra empresa passa a mostrar a obra daqui.
  const colabFora = await foraDaEmpresa(sql, 'colaborador', linhas.map(l => l.colaboradorId), rh.empresa_id);
  if (colabFora.length) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado', { colaboradores: colabFora });
  const eqFora = await foraDaEmpresa(sql, 'equipe', linhas.map(l => l.eq), rh.empresa_id);
  if (eqFora.length) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada', { equipes: eqFora });

  let gravadas = 0;
  for (const { colaboradorId, eq, cerca } of linhas) {
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
