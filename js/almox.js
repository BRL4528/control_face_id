// EPI e ferramentas: catálogo de itens e entregas ao colaborador. Módulo puro,
// sem DOM (painel e servidor).
//
// EPI (NR-6): entrega registrada com o CA vigente e confirmada pelo colaborador
// com o rosto no app (a NR-6 aceita registro eletrônico, inclusive biométrico).
// Vida útil opcional gera o alerta de troca. Ferramenta: cautela com data para
// devolver; o RH registra a devolução.
export const TIPOS_ITEM = {
  epi:        { rotulo: 'EPI' },
  ferramenta: { rotulo: 'Ferramenta' }
};

export const ESTADOS_ENTREGA = {
  aguardando_ciencia: 'Aguardando confirmação no app', confirmada: 'Confirmada', devolvida: 'Devolvida', cancelada: 'Cancelada'
};

const mais = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Alertas de uma entrega ainda com o colaborador:
 *   ca_vencido      o CA do EPI já estava vencido na data da entrega
 *   trocar          EPI passou da vida útil (ou passa em até 7 dias: trocar_em_breve)
 *   atrasada        ferramenta não devolvida depois da data combinada
 * Devolve { alertas: [...], troca_em, devolver_ate }.
 */
export function alertasDaEntrega(entrega, item, hoje) {
  const a = [];
  if (!item || entrega.estado === 'devolvida' || entrega.estado === 'cancelada') return { alertas: a };
  let trocaEm = null;
  if (item.tipo === 'epi') {
    if (item.ca_validade && item.ca_validade < entrega.entregue_em) a.push('ca_vencido');
    if (item.vida_util_dias) {
      trocaEm = mais(entrega.entregue_em, Number(item.vida_util_dias));
      if (trocaEm <= hoje) a.push('trocar'); else if (trocaEm <= mais(hoje, 7)) a.push('trocar_em_breve');
    }
  }
  if (item.tipo === 'ferramenta' && entrega.devolver_ate && entrega.devolver_ate < hoje) a.push('atrasada');
  return { alertas: a, troca_em: trocaEm, devolver_ate: entrega.devolver_ate || null };
}
