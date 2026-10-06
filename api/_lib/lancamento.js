// Lançamento manual do RH. A marcacao é imutável (trigger), então corrigir é
// sempre "lançamento novo + correção": nada é editado ou apagado.
import { novoId } from './db.js';

/** Statements (para sql.transaction) que gravam o lançamento e o rastro de quem lançou. */
export function statementsLancamento(txn, { empresaId, colaboradorId, equipeId, tipo, marcadoEm, dia, motivo, rhId }) {
  const idCliente = novoId();
  return {
    idCliente,
    stmts: [
      txn`INSERT INTO marcacao (id_cliente, empresa_id, colaborador_id, equipe_id, tipo, origem, veredito,
            marcado_em, marcado_dia, dentro_cerca, motivo, requer_revisao)
          VALUES (${idCliente}, ${empresaId}, ${colaboradorId}, ${equipeId}, ${tipo}, 'manual', 'aceito',
            ${marcadoEm}, ${dia}, ${null}, ${motivo}, ${false})`,
      txn`INSERT INTO correcao (id, empresa_id, alvo_tipo, alvo_id, acao, motivo, usuario_rh_id)
          VALUES (${novoId()}, ${empresaId}, 'marcacao', ${idCliente}, 'aprovar', ${motivo}, ${rhId})`
    ]
  };
}

/** Não aceita instante no futuro (folga de 5 min para relógio). */
export const noFuturo = iso => Date.parse(iso) > Date.now() + 5 * 60000;
