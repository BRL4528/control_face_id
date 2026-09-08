// Cria ou atualiza colaborador. Upsert por (empresa, matrícula): a mesma rota
// serve para cadastro novo e edição. Não mexe em biometria — isso é /rh/biometria.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { sincronizarBloqueios } from '../_lib/dispositivos.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const nome = String(b.nome || '').trim();
  const matricula = String(b.matricula || '').trim();
  if (!nome || !matricula) return erro(res, 400, 'CORPO_INVALIDO', 'nome e matrícula obrigatórios');
  const papel = b.papel === 'gestor' ? 'gestor' : 'colaborador';
  const equipeId = b.equipe_id || null;
  const sql = db();

  const existentes = await sql`
    SELECT id FROM colaborador WHERE empresa_id = ${rh.empresa_id} AND matricula = ${matricula} LIMIT 1`;

  if (existentes[0]) {
    await sql`UPDATE colaborador SET nome=${nome}, papel=${papel}, equipe_padrao=${equipeId},
              ativo=${b.ativo === false ? false : true} WHERE id = ${existentes[0].id}`;
    // Saiu da empresa ⇒ aparelho bloqueado (403 no app); voltou ⇒ libera.
    await sincronizarBloqueios(sql, rh.empresa_id);
    return ok(res, { colaborador_id: existentes[0].id, atualizado: true });
  }

  const id = novoId();
  await sql`INSERT INTO colaborador (id, empresa_id, nome, matricula, papel, equipe_padrao)
            VALUES (${id}, ${rh.empresa_id}, ${nome}, ${matricula}, ${papel}, ${equipeId})`;
  return ok(res, { colaborador_id: id, criado: true });
}
