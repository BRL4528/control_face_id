// Equipes: criar/renomear e vincular/desvincular colaboradores. A cerca NÃO fica
// aqui — ela é definida pela escala (/rh/plano) ou por dia (/rh/alocar), porque
// a mesma equipe pode operar em locais diferentes em dias diferentes.
//
//   • sem acao (default): cria (sem equipe_id) ou renomeia (com equipe_id)
//   • acao 'vincular'    { equipe_id, colaborador_id }: colaborador.equipe_padrao = equipe
//   • acao 'desvincular' { colaborador_id }: equipe_padrao = NULL
// O vínculo é a equipe PADRÃO da pessoa. Não mexe em escala nem em alocação já
// gerada: quem entra na equipe depois precisa ser marcado na escala pelo RH.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const sql = db();

  if (b.acao === 'vincular' || b.acao === 'desvincular') {
    if (!b.colaborador_id) return erro(res, 400, 'CORPO_INVALIDO', 'colaborador_id obrigatório');
    let equipeId = null;
    if (b.acao === 'vincular') {
      if (!b.equipe_id) return erro(res, 400, 'CORPO_INVALIDO', 'equipe_id obrigatório');
      const eq = await sql`SELECT id FROM equipe WHERE id=${b.equipe_id} AND empresa_id=${rh.empresa_id} AND ativo=true LIMIT 1`;
      if (!eq[0]) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada');
      equipeId = b.equipe_id;
    }
    const r = await sql`UPDATE colaborador SET equipe_padrao=${equipeId}
                        WHERE id=${b.colaborador_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'COLABORADOR_NAO_ENCONTRADO', 'colaborador não encontrado');
    return ok(res, { colaborador_id: b.colaborador_id, equipe_id: equipeId });
  }

  const nome = String(b.nome || '').trim();
  if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');

  if (b.equipe_id) {
    await sql`UPDATE equipe SET nome=${nome}, ativo=${b.ativo === false ? false : true}
              WHERE id=${b.equipe_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { equipe_id: b.equipe_id, atualizado: true });
  }
  const id = novoId();
  await sql`INSERT INTO equipe (id, empresa_id, nome) VALUES (${id}, ${rh.empresa_id}, ${nome})`;
  return ok(res, { equipe_id: id, criado: true });
}
