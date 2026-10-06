// Papéis personalizados do colaborador (aparecem no cadastro dele).
//   { nome }                         → cria
//   { papel_id, nome?, ativo? }      → renomeia / ativa / desativa
//   { papel_id, excluir:true }       → apaga (409 se algum colaborador usa)
// Os papéis de sistema (colaborador, líder de equipe, gestor) não são editáveis.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const RESERVADOS = ['colaborador', 'líder de equipe', 'lider de equipe', 'líder', 'lider', 'gestor'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const sql = db();

  if (b.papel_id && b.excluir) {
    const uso = await sql`SELECT count(*)::int AS n FROM colaborador WHERE empresa_id=${rh.empresa_id} AND papel=${b.papel_id}`;
    if (uso[0].n) return erro(res, 409, 'PAPEL_EM_USO', `${uso[0].n} colaborador(es) usam este papel — desative em vez de excluir`);
    await sql`DELETE FROM papel WHERE id=${b.papel_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { excluido: true });
  }

  const nome = b.nome === undefined ? null : String(b.nome).trim().slice(0, 60);
  if (nome !== null) {
    if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
    if (RESERVADOS.includes(nome.toLowerCase())) return erro(res, 409, 'PAPEL_RESERVADO', 'este nome já é um papel do sistema');
    const igual = await sql`SELECT id FROM papel WHERE empresa_id=${rh.empresa_id} AND lower(nome)=lower(${nome}) LIMIT 1`;
    if (igual[0] && igual[0].id !== b.papel_id) return erro(res, 409, 'PAPEL_DUPLICADO', 'já existe um papel com este nome');
  }

  if (b.papel_id) {
    const r = await sql`UPDATE papel SET nome=COALESCE(${nome}, nome), ativo=COALESCE(${typeof b.ativo === 'boolean' ? b.ativo : null}, ativo)
                        WHERE id=${b.papel_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'PAPEL_NAO_ENCONTRADO', 'papel não encontrado');
    return ok(res, { papel_id: b.papel_id, atualizado: true });
  }
  if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
  const id = novoId();
  await sql`INSERT INTO papel (id, empresa_id, nome) VALUES (${id}, ${rh.empresa_id}, ${nome})`;
  return ok(res, { papel_id: id, criado: true });
}
