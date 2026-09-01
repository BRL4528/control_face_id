// Decisão do RH sobre uma pendência (marcação em revisão ou template pendente).
// NUNCA altera a marcação original — grava uma linha em correcao. O estado atual
// de uma marcação é derivado: marcação + última correção que a referencia.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const tipo = b.tipo === 'template' ? 'template' : 'marcacao';
  const acao = b.acao === 'rejeitar' ? 'rejeitar' : 'aprovar';
  if (!b.id) return erro(res, 400, 'CORPO_INVALIDO', 'id obrigatório');
  const sql = db();

  await sql`
    INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
    VALUES (${novoId()}, ${rh.empresa_id}, ${tipo}, ${b.id}, ${acao}, ${b.motivo || null}, ${rh.sub})`;

  // Template: aprovar mantém ativo; rejeitar volta o anterior a ativo.
  if (tipo === 'template') {
    if (acao === 'rejeitar') {
      const alvos = await sql`SELECT colaborador_id FROM template_facial WHERE id=${b.id} LIMIT 1`;
      if (alvos[0]) {
        await sql`UPDATE template_facial SET estado='reprovado' WHERE id=${b.id}`;
        await sql`UPDATE template_facial SET estado='ativo'
                  WHERE colaborador_id=${alvos[0].colaborador_id} AND estado='substituido'
                  AND versao=(SELECT MAX(versao) FROM template_facial
                              WHERE colaborador_id=${alvos[0].colaborador_id} AND estado='substituido')`;
      }
    } else {
      await sql`UPDATE template_facial SET estado='ativo' WHERE id=${b.id}`;
    }
  }
  return ok(res, { decidido: true });
}
