// Advertências, notificações e acidentes de trabalho: catálogo e prazo da CAT.
// Módulo puro, sem DOM: usado pelo painel e pelo servidor.
import { diasDeFeriado } from './regras.js';

export const TIPOS_EVENTO = {
  advertencia: { rotulo: 'Advertência', ciencia: true },
  notificacao: { rotulo: 'Notificação', ciencia: true },
  acidente:    { rotulo: 'Acidente de trabalho', cat: true }
};

export const ESTADOS_EVENTO = {
  aguardando_ciencia: 'Aguardando ciência', ciente: 'Ciente', recusou: 'Recusou (com testemunhas)',
  aguardando_cat: 'Aguardando CAT', concluido: 'CAT emitida', cancelado: 'Cancelado'
};

const proximoDia = d => new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);

/**
 * Prazo da CAT: até o 1º dia útil seguinte ao acidente (Lei 8.213/91, art. 22).
 * Pula sábado, domingo e feriado (nacionais + os da empresa). Óbito é imediato,
 * o painel avisa à parte.
 */
export function prazoCat(dia, feriadosDaEmpresa) {
  const fer = diasDeFeriado(dia, String(Number(dia.slice(0, 4)) + 1) + '-12-31', feriadosDaEmpresa);
  let d = proximoDia(dia);
  for (;;) {
    const w = new Date(d + 'T12:00:00Z').getUTCDay();
    if (w !== 0 && w !== 6 && !fer.has(d)) return d;
    d = proximoDia(d);
  }
}

/** Situação do prazo de um acidente ainda sem CAT: 'no_prazo' | 'vence_hoje' | 'atrasada'. */
export function situacaoCat(evento, hoje, feriadosDaEmpresa) {
  const prazo = prazoCat(evento.data, feriadosDaEmpresa);
  return { prazo, situacao: hoje > prazo ? 'atrasada' : hoje === prazo ? 'vence_hoje' : 'no_prazo' };
}
