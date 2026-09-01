// Cria ou renomeia equipe. A cerca NÃO fica aqui — ela é definida por dia na
// alocação (/rh/alocar), porque a mesma equipe pode operar em locais diferentes
// em dias diferentes.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const nome = String(b.nome || '').trim();
  if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
  const sql = db();

  if (b.equipe_id) {
    await sql`UPDATE equipe SET nome=${nome}, ativo=${b.ativo === false ? false : true}
              WHERE id=${b.equipe_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { equipe_id: b.equipe_id, atualizado: true });
  }
  const id = novoId();
  await sql`INSERT INTO equipe (id, empresa_id, nome) VALUES (${id}, ${rh.empresa_id}, ${nome})`;
  return ok(res, { equipe_id: id, criado: true });
}
