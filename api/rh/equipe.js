// Equipes: criar/renomear, definir o local (cerca) e vincular/desvincular
// colaboradores. A equipe É a obra: o local dela é a cerca de quem está nela,
// todo dia, sem escala nenhuma. Escala (/rh/plano) e ajuste do dia (/rh/alocar)
// continuam valendo para a exceção e ganham da equipe quando existem.
//
//   • sem acao (default): cria (sem equipe_id) ou renomeia (com equipe_id)
//   • acao 'local'       { equipe_id, local_id|null }: define/limpa a cerca da equipe
//   • acao 'vincular'    { equipe_id, colaborador_id }: colaborador.equipe_padrao = equipe
//   • acao 'desvincular' { colaborador_id }: equipe_padrao = NULL
// O vínculo é a equipe PADRÃO da pessoa e, desde a integração com o Bitrix,
// também a ESCALA: quem entra na equipe entra nos planos ativos dela (e sai dos
// da anterior) de hoje em diante — mesmo efeito de mover o card no kanban.
import { db, novoId } from '../_lib/db.js';
import { realocarColaboradores } from '../_lib/escala.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const sql = db();

  // Local da equipe: a cerca padrão de todo mundo dela. null = volta a não ter.
  if (b.acao === 'local') {
    if (!b.equipe_id) return erro(res, 400, 'CORPO_INVALIDO', 'equipe_id obrigatório');
    if (b.local_id) {
      const loc = await sql`SELECT id FROM local WHERE id=${b.local_id} AND empresa_id=${rh.empresa_id} AND ativo=true LIMIT 1`;
      if (!loc[0]) return erro(res, 404, 'LOCAL_NAO_ENCONTRADO', 'local não encontrado');
    }
    const r = await sql`UPDATE equipe SET local_id=${b.local_id || null}
                        WHERE id=${b.equipe_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'EQUIPE_NAO_ENCONTRADA', 'equipe não encontrada');
    return ok(res, { equipe_id: b.equipe_id, local_id: b.local_id || null });
  }

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
    const hoje = new Date().toISOString().slice(0, 10);
    const esc = await realocarColaboradores(sql, rh.empresa_id, [{ colaborador_id: b.colaborador_id, equipe_id: equipeId }], hoje);
    return ok(res, { colaborador_id: b.colaborador_id, equipe_id: equipeId, planos_ajustados: esc.planos_ajustados });
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
