// Lançamento manual de ponto pelo RH — o caminho para resolver a exceção
// "sem entrada" (pessoa alocada que não bateu ponto). NÃO é o mesmo que o app do
// colaborador: aqui é um ato administrativo, autenticado pelo JWT do RH, com
// justificativa que fica na auditoria.
//
//   • Insere uma marcacao origem='manual', veredito='aceito' — é decisão
//     explícita do RH, não passa por revisão de novo (requer_revisao=false).
//   • Puxa equipe da alocação do dia da pessoa, quando houver.
//   • dentro_cerca=null: registro administrativo não tem GPS para conferir.
//   • Grava também uma correcao (aprovar) apontando para a marcação, deixando
//     rastro de QUEM lançou e POR QUÊ. A marcacao continua imutável.
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const colaboradorId = b.colaborador_id;
  const tipo = b.tipo === 'saida' ? 'saida' : 'entrada';
  if (!colaboradorId) return erro(res, 400, 'CORPO_INVALIDO', 'colaborador_id obrigatório');

  const marcadoEm = b.marcado_em || new Date().toISOString();
  const dia = String(b.marcado_dia || marcadoEm).slice(0, 10);
  const sql = db();

  // A pessoa é da empresa do RH? (evita lançar ponto de outro tenant)
  const pessoas = await sql`
    SELECT id FROM colaborador WHERE id = ${colaboradorId} AND empresa_id = ${rh.empresa_id} LIMIT 1`;
  if (!pessoas.length) return erro(res, 404, 'NAO_ENCONTRADO', 'colaborador não encontrado');

  // Equipe vem da alocação do dia, se existir.
  const alocs = await sql`
    SELECT equipe_id FROM alocacao
    WHERE empresa_id = ${rh.empresa_id} AND colaborador_id = ${colaboradorId} AND dia = ${dia}
    LIMIT 1`;
  const equipeId = (alocs[0] && alocs[0].equipe_id) || null;

  const idCliente = novoId();
  await sql`
    INSERT INTO marcacao (
      id_cliente, empresa_id, colaborador_id, equipe_id, tipo, origem, veredito,
      marcado_em, marcado_dia, dentro_cerca, motivo, requer_revisao
    ) VALUES (
      ${idCliente}, ${rh.empresa_id}, ${colaboradorId}, ${equipeId},
      ${tipo}, 'manual', 'aceito',
      ${marcadoEm}, ${dia}, ${null}, ${b.motivo || 'lançado pelo RH'}, ${false}
    )
    ON CONFLICT (id_cliente) DO NOTHING`;

  // Rastro de auditoria: quem lançou, quando e por quê.
  await sql`
    INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
    VALUES (${novoId()}, ${rh.empresa_id}, 'marcacao', ${idCliente}, 'aprovar', ${b.motivo || 'lançamento manual'}, ${rh.sub})`;

  return ok(res, { lancado: true, id_cliente: idCliente, tipo, marcado_dia: dia });
}
