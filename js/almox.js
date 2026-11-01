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
 * A entrega foi substituída por outra mais nova do mesmo item ao mesmo
 * colaborador (a troca do EPI)? Entrega cancelada não substitui nada. Pura.
 */
export function entregaSubstituida(entrega, entregas) {
  return (entregas || []).some(o => o && o.id !== entrega.id && o.item_id === entrega.item_id &&
    o.colaborador_id === entrega.colaborador_id && o.estado !== 'cancelada' &&
    String(o.entregue_em || '') > String(entrega.entregue_em || ''));
}

/** O CA do item está vencido na data `dia` (YYYY-MM-DD)? Só EPI tem CA. Pura. */
export function caVencidoEm(item, dia) {
  return !!(item && item.tipo === 'epi' && item.ca_validade && dia && item.ca_validade < dia);
}

/**
 * Alertas de uma entrega ainda com o colaborador:
 *   ca_vencido      o CA do EPI já estava vencido na data da entrega
 *   trocar          EPI passou da vida útil (ou passa em até 7 dias: trocar_em_breve)
 *   atrasada        ferramenta não devolvida depois da data combinada
 * `outras`: a lista de entregas (ou true/false já calculado). Entrega substituída
 * por uma mais nova do mesmo item e colaborador não pede troca.
 * Devolve { alertas: [...], troca_em, devolver_ate, substituida }.
 */
export function alertasDaEntrega(entrega, item, hoje, outras) {
  const a = [];
  if (!item || entrega.estado === 'devolvida' || entrega.estado === 'cancelada') return { alertas: a };
  // Só EPI é trocado: ferramenta emprestada de novo continua sendo outra ferramenta com a pessoa.
  const substituida = item.tipo === 'epi' && (typeof outras === 'boolean' ? outras : entregaSubstituida(entrega, outras));
  let trocaEm = null;
  if (item.tipo === 'epi') {
    if (caVencidoEm(item, entrega.entregue_em)) a.push('ca_vencido');
    if (item.vida_util_dias && !substituida) {
      trocaEm = mais(entrega.entregue_em, Number(item.vida_util_dias));
      if (trocaEm <= hoje) a.push('trocar'); else if (trocaEm <= mais(hoje, 7)) a.push('trocar_em_breve');
    }
  }
  if (item.tipo === 'ferramenta' && entrega.devolver_ate && entrega.devolver_ate < hoje) a.push('atrasada');
  return { alertas: a, troca_em: trocaEm, devolver_ate: entrega.devolver_ate || null, substituida };
}

/** Nome do item com o código ou patrimônio, quando houver: "Furadeira (PAT-1)". Pura. */
export function nomeComCodigo(item) {
  if (!item) return '?';
  const cod = String(item.codigo || '').trim();
  return (item.nome || '?') + (cod ? ' (' + cod + ')' : '');
}

/**
 * Entrega ainda pode ser cancelada? Só a que aguarda a confirmação no app: a
 * confirmada pelo rosto ou devolvida é registro da Ficha de EPI (NR-6) e sai
 * pela baixa (devolvido / trocado), não some. Pura.
 */
export function podeCancelarEntrega(entrega) {
  return !!entrega && entrega.estado === 'aguardando_ciencia';
}
