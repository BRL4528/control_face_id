// Correção de um lançamento de ponto pelo RH. A marcacao é imutável, então:
//   • 'anular'   → correção 'rejeitar' (a batida sai de horas, presença e espelho ativo);
//   • 'corrigir' → anula a original E lança uma nova manual (tipo/dia/hora corretos),
//                  na mesma transação. A nova guarda "corrige <id>" no motivo.
// Justificativa obrigatória; tudo vai para a auditoria e para o card do Bitrix.
//   { id, acao:'anular'|'corrigir', motivo, tipo?, dia?, hora? }
import { db } from '../_lib/db.js';
import { novoId } from '../_lib/db.js';
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
  const acao = b.acao === 'corrigir' ? 'corrigir' : b.acao === 'anular' ? 'anular' : null;
  const motivo = String(b.motivo || '').trim();
  if (!b.id || !acao) return erro(res, 400, 'CORPO_INVALIDO', "id e acao ('anular' ou 'corrigir') obrigatórios");
  if (!motivo) return erro(res, 400, 'JUSTIFICATIVA_OBRIGATORIA', 'informe a justificativa');

  const sql = db();
  const [orig] = await sql`
    SELECT m.id_cliente, m.colaborador_id, m.equipe_id, m.tipo, m.marcado_em, c.nome, c.bitrix_card_id,
           EXISTS (SELECT 1 FROM correcao co WHERE co.alvo_tipo='marcacao' AND co.alvo_id=m.id_cliente AND co.acao='rejeitar') AS anulada
    FROM marcacao m LEFT JOIN colaborador c ON c.id = m.colaborador_id
    WHERE m.id_cliente = ${b.id} AND m.empresa_id = ${rh.empresa_id} LIMIT 1`;
  if (!orig) return erro(res, 404, 'ALVO_NAO_ENCONTRADO', 'marcação não encontrada');
  if (!orig.colaborador_id) return erro(res, 400, 'SEM_COLABORADOR', 'batida de aparelho não identificado: identifique o aparelho em Pendências');
  if (orig.anulada) return erro(res, 409, 'JA_ANULADA', 'esta marcação já foi anulada');

  const fuso = await fusoDaEmpresa(sql, rh.empresa_id);
  const quem = rh.nome || rh.usuario || 'RH';
  let novo = null, marcadoEm = null, dia = null, equipeId = orig.equipe_id;
  if (acao === 'corrigir') {
    const tipo = b.tipo === 'saida' ? 'saida' : b.tipo === 'entrada' ? 'entrada' : orig.tipo;
    marcadoEm = (b.dia || b.hora)
      ? instanteNoFuso(b.dia || diaNoFuso(orig.marcado_em, fuso), b.hora, fuso)
      : new Date(orig.marcado_em).toISOString();
    if (!marcadoEm) return erro(res, 400, 'CORPO_INVALIDO', 'dia e hora inválidos');
    if (noFuturo(marcadoEm)) return erro(res, 400, 'DATA_FUTURA', 'não é possível lançar ponto no futuro');
    dia = diaNoFuso(marcadoEm, fuso);
    const al = await sql`SELECT equipe_id FROM alocacao WHERE empresa_id=${rh.empresa_id} AND colaborador_id=${orig.colaborador_id} AND dia=${dia} LIMIT 1`;
    equipeId = (al[0] && al[0].equipe_id) || orig.equipe_id || null;
    novo = { tipo, marcado_em: marcadoEm };
  }

  let idNovo = null;
  await sql.transaction(txn => {
    const stmts = [];
    if (acao === 'corrigir') {
      const r = statementsLancamento(txn, { empresaId: rh.empresa_id, colaboradorId: orig.colaborador_id, equipeId, tipo: novo.tipo,
        marcadoEm, dia, motivo: `corrige ${orig.id_cliente}: ${motivo}`, rhId: rh.sub });
      idNovo = r.idCliente; stmts.push(...r.stmts);
    }
    stmts.push(txn`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
      VALUES (${novoId()}, ${rh.empresa_id}, 'marcacao', ${orig.id_cliente}, 'rejeitar',
        ${(acao === 'corrigir' ? 'corrigida pelo RH (substituída por ' + idNovo + '): ' : 'anulada pelo RH: ') + motivo}, ${rh.sub})`);
    return stmts;
  });

  await comentarNoCard(orig, montarComentarioLancamento({
    acao, decisao: motivo, rh: quem, fuso, original: { tipo: orig.tipo, marcado_em: orig.marcado_em }, novo, alvoId: orig.id_cliente
  }));
  return ok(res, { acao, anulada: orig.id_cliente, novo_id: idNovo });
}
