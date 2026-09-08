// Jornadas (turnos) da empresa. Cria, edita ou desativa uma jornada; e associa
// uma jornada + supervisor a uma equipe. Mesmo endpoint para os dois papéis:
//   • { nome, entrada, saida, tolerancia_min } → cria/edita jornada
//   • { equipe_id, jornada_id, supervisor_id } → associa à equipe
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();

  // Modo associação: liga a equipe a uma jornada/supervisor (qualquer um pode ser null).
  if (b.equipe_id && !b.nome) {
    await sql`UPDATE equipe SET jornada_id=${b.jornada_id || null}, supervisor_id=${b.supervisor_id || null}
              WHERE id=${b.equipe_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { equipe_id: b.equipe_id, associado: true });
  }

  // Modo jornada: cria ou edita.
  const nome = String(b.nome || '').trim();
  if (!nome) return erro(res, 400, 'CORPO_INVALIDO', 'nome obrigatório');
  const entrada = HORA.test(b.entrada) ? b.entrada : '07:00';
  const saida = HORA.test(b.saida) ? b.saida : '17:00';
  const tol = Math.max(0, Math.min(Number(b.tolerancia_min) || 10, 120));

  if (b.jornada_id) {
    await sql`UPDATE jornada SET nome=${nome}, entrada=${entrada}, saida=${saida},
              tolerancia_min=${tol}, ativa=${b.ativa === false ? false : true}
              WHERE id=${b.jornada_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { jornada_id: b.jornada_id, atualizado: true });
  }
  const id = novoId();
  await sql`INSERT INTO jornada (id, empresa_id, nome, entrada, saida, tolerancia_min)
            VALUES (${id}, ${rh.empresa_id}, ${nome}, ${entrada}, ${saida}, ${tol})`;
  return ok(res, { jornada_id: id, criado: true });
}
