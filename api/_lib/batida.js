// Regras puras da batida que chega do app (api/ponto.js): validação item a item
// e o motivo gravado para a revisão do RH. Sem I/O, testável em Node.
import { noFuturo } from './lancamento.js';

const TIPOS = ['entrada', 'saida'];
const INT_MAX = 2147483647;   // deriva_ms é integer no banco
const REAL_MAX = 1e6;         // score e precisao_m são real: fora disso é lixo (e estouraria a coluna)

/** Número finito, null para vazio/ausente, NaN para lixo. */
const numOuNulo = v => (v == null || v === '') ? null : (typeof v === 'number' || typeof v === 'string') && Number.isFinite(Number(v)) ? Number(v) : NaN;

/**
 * Confere e normaliza uma batida do lote. Pura.
 *   { erro: 'motivo' }  item rejeitado (os outros do lote seguem)
 *   { item: {...} }      campos prontos para o INSERT, marcado_em em ISO
 * Batida antiga (fila offline de dias) continua válida; a do futuro vem marcada
 * em `futuro` para ir à revisão.
 */
export function normalizarBatida(m) {
  if (!m || typeof m !== 'object') return { erro: 'campos obrigatórios ausentes' };
  // id_cliente vai como veio: é a chave que o app usa para tirar o item da fila.
  const id = typeof m.id_cliente === 'string' && m.id_cliente.trim() ? m.id_cliente : '';
  if (!id || !m.tipo || m.marcado_em == null || m.marcado_em === '') return { erro: 'campos obrigatórios ausentes' };
  if (id.length > 100) return { erro: 'id_cliente inválido' };
  if (!TIPOS.includes(m.tipo)) return { erro: 'tipo inválido' };
  const t = typeof m.marcado_em === 'string' || typeof m.marcado_em === 'number' ? new Date(m.marcado_em).getTime() : NaN;
  if (!Number.isFinite(t)) return { erro: 'marcado_em inválido' };
  const marcadoEm = new Date(t).toISOString();

  const lat = numOuNulo(m.lat), lng = numOuNulo(m.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || (lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) {
    return { erro: 'coordenadas inválidas' };
  }
  const semGps = lat == null || lng == null;
  const prec = numOuNulo(m.precisao_m), score = numOuNulo(m.score), deriva = numOuNulo(m.deriva_ms);

  return {
    item: {
      id_cliente: id,
      tipo: m.tipo,
      origem: m.origem === 'manual' ? 'manual' : 'biometria',
      veredito: m.veredito,
      score: Number.isFinite(score) && Math.abs(score) <= REAL_MAX ? score : null,
      liveness_ok: typeof m.liveness_ok === 'boolean' ? m.liveness_ok : null,
      marcado_em: marcadoEm,
      futuro: noFuturo(marcadoEm),
      deriva_ms: Number.isFinite(deriva) ? Math.max(-INT_MAX, Math.min(INT_MAX, Math.round(deriva))) : 0,
      lat: semGps ? null : lat,
      lng: semGps ? null : lng,
      precisao_m: Number.isFinite(prec) && prec >= 0 && prec <= REAL_MAX ? prec : null,
      equipe_id: typeof m.equipe_id === 'string' && m.equipe_id.trim() ? m.equipe_id.trim() : null,
      motivo: typeof m.motivo === 'string' && m.motivo.trim() ? m.motivo.trim().slice(0, 500) : null,
      foto_url: typeof m.foto_url === 'string' && m.foto_url ? m.foto_url : null
    }
  };
}

/**
 * Motivo gravado na batida: junta todas as causas em vez de uma esconder a outra
 * (viagem não apaga a prova de vida reprovada). Puro. null quando não há nenhuma.
 *   { afastado, bloqueio: rótulo da ocorrência que bloqueia, futuro, externo,
 *     visitado: nome do perímetro do gestor, cliente: motivo vindo do app }
 */
export function motivoDaBatida({ afastado, bloqueio, futuro, externo, visitado, cliente } = {}) {
  const partes = [
    afastado ? 'colaborador afastado' : null,
    bloqueio ? 'colaborador em ' + bloqueio : null,
    futuro ? 'horário no futuro' : null,
    externo ? 'trabalho externo (viagem)' : null,
    visitado ? 'gestor em outro local: ' + visitado : null,
    cliente || null
  ].filter(Boolean);
  return partes.length ? partes.join('; ') : null;
}
