// Lançamento manual de ponto pelo RH: a pessoa não bateu (ou bateu errado) e o RH
// registra a entrada ou a saída. Ato administrativo, autenticado pelo JWT do RH,
// com justificativa OBRIGATÓRIA que fica na auditoria e vai ao card do Bitrix.
//
//   { colaborador_id, tipo:'entrada'|'saida', motivo,
//     dia:'YYYY-MM-DD' + hora:'HH:MM' (relógio da empresa)  |  marcado_em (ISO) }
//
//   • Grava marcacao origem='manual', veredito='aceito' (decisão do RH, sem nova revisão).
//   • Equipe vem da alocação do dia, quando houver. Sem GPS: dentro_cerca=null.
//   • Grava também uma correcao (aprovar) com quem lançou e por quê.
import { db } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { diaNoFuso, fusoDaEmpresa, instanteNoFuso } from '../_lib/dia.js';
import { statementsLancamento, noFuturo } from '../_lib/lancamento.js';
import { comentarNoCard, montarComentarioLancamento } from '../_lib/bitrix-saida.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');

  const b = corpo(req);
  const colaboradorId = b.colaborador_id;
  const tipo = b.tipo === 'saida' ? 'saida' : 'entrada';
  const motivo = String(b.motivo || '').trim();
  if (!colaboradorId) return erro(res, 400, 'CORPO_INVALIDO', 'colaborador_id obrigatório');
  if (!motivo) return erro(res, 400, 'JUSTIFICATIVA_OBRIGATORIA', 'informe a justificativa do lançamento');

  const sql = db();
  const fuso = await fusoDaEmpresa(sql, rh.empresa_id);
  const marcadoEm = (b.dia || b.hora) ? instanteNoFuso(b.dia, b.hora, fuso) : (b.marcado_em || new Date().toISOString());
  if (!marcadoEm || isNaN(Date.parse(marcadoEm))) return erro(res, 400, 'CORPO_INVALIDO', 'dia e hora inválidos');
  if (noFuturo(marcadoEm)) return erro(res, 400, 'DATA_FUTURA', 'não é possível lançar ponto no futuro');
  const dia = diaNoFuso(marcadoEm, fuso);

  // A pessoa é da empresa do RH? (evita lançar ponto de outro tenant)
  const pessoas = await sql`
    SELECT id, nome, bitrix_card_id FROM colaborador WHERE id = ${colaboradorId} AND empresa_id = ${rh.empresa_id} LIMIT 1`;
  if (!pessoas.length) return erro(res, 404, 'NAO_ENCONTRADO', 'colaborador não encontrado');

  const alocs = await sql`
    SELECT equipe_id FROM alocacao
    WHERE empresa_id = ${rh.empresa_id} AND colaborador_id = ${colaboradorId} AND dia = ${dia} LIMIT 1`;
  const equipeId = (alocs[0] && alocs[0].equipe_id) || null;

  let id;
  await sql.transaction(txn => {
    const r = statementsLancamento(txn, { empresaId: rh.empresa_id, colaboradorId, equipeId, tipo, marcadoEm, dia, motivo, rhId: rh.sub });
    id = r.idCliente;
    return r.stmts;
  });

  await comentarNoCard(pessoas[0], montarComentarioLancamento({
    acao: 'lancar', decisao: motivo, rh: rh.nome || rh.usuario || 'RH', fuso, novo: { tipo, marcado_em: marcadoEm }, alvoId: id
  }));
  return ok(res, { lancado: true, id_cliente: id, tipo, marcado_dia: dia });
}
