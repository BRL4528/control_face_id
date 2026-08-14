// Regras puras — sem DOM, sem rede, sem IndexedDB.
// Fica separado justamente para ser testável em Node, que é onde os erros
// que custam caro (ponto dobrado, tipo de marcação errado) aparecem.

/** Entrada ou saída, deduzido do que a pessoa já tem no dia. */
export function tipoDaVez(marcacoesDoDiaDaPessoa) {
  const validas = (marcacoesDoDiaDaPessoa || []).filter(m => m && m.tipo);
  return validas.length % 2 === 0 ? 'entrada' : 'saida';
}

/** Veredito a partir da distância e dos limiares configurados. */
export function vereditoPorDistancia(dist, cfg) {
  if (dist == null || !isFinite(dist)) return 'revisar';
  if (dist <= cfg.limiarAceite) return 'aceito';
  if (dist <= cfg.limiarCinza) return 'revisar';
  return 'rejeitado';
}

/**
 * Melhores candidatos na galeria. Cada pessoa tem N templates; vale o menor.
 * Devolve ordenado, com a margem entre 1º e 2º — que é o número que denuncia
 * identificação 1:N frágil.
 */
export function ranquear(descritor, galeria, distancia) {
  const r = (galeria || [])
    .filter(p => p && Array.isArray(p.vetores) && p.vetores.length)
    .map(p => ({
      pessoa: p,
      dist: Math.min.apply(null, p.vetores.map(v => distancia(descritor, v)))
    }))
    .sort((a, b) => a.dist - b.dist);
  return { lista: r, melhor: r[0] || null, margem: r.length > 1 ? r[1].dist - r[0].dist : null };
}

/** A marcação precisa passar pela mesa do RH? Mesma regra que o servidor aplica. */
export function precisaRevisao(m, papel, cfg) {
  return m.veredito !== 'aceito'
    || m.origem === 'manual'
    || papel === 'gestor'
    || Math.abs(Number(m.deriva_relogio_ms) || 0) > 120000;
}

/** Mesma pessoa não marca duas vezes em sequência por engano da fila. */
export function emCooldown(pessoaId, marcacoesDoDia, agoraMs, cooldownMs) {
  return (marcacoesDoDia || []).some(m =>
    m.pessoa_id === pessoaId &&
    agoraMs - Date.parse(m.marcado_em) < cooldownMs);
}

/**
 * Quais itens saem da fila local depois da resposta do servidor.
 * `aceito` e `duplicado` significam que o servidor tem o registro — some.
 * `rejeitado` fica retido: é problema que precisa de gente.
 */
export function itensParaRemover(resultados) {
  return (resultados || [])
    .filter(r => r && (r.status === 'aceito' || r.status === 'duplicado'))
    .map(r => r.id_cliente);
}

/** Hora do aparelho corrigida pela diferença medida contra o servidor. */
export function agoraCorrigido(derivaMs, agoraMs) {
  return new Date((agoraMs == null ? Date.now() : agoraMs) - (Number(derivaMs) || 0));
}

/**
 * Deriva do relógio. Desconta metade do tempo de ida e volta, senão a
 * latência da rede vira "relógio errado" e enche a fila do RH à toa.
 */
export function calcularDeriva(t0, t1, servidorISO) {
  const servidor = Date.parse(servidorISO);
  if (!isFinite(servidor)) return 0;
  return Math.round((t0 + (t1 - t0) / 2) - servidor);
}

/** A carga vale para o turno de hoje? */
export function cargaValida(carga, agoraMs) {
  if (!carga || !carga.expira_em) return false;
  const exp = Date.parse(carga.expira_em);
  return isFinite(exp) && (agoraMs == null ? Date.now() : agoraMs) < exp;
}

/** Distância euclidiana entre descritores. */
export function euclidiana(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

export function dia(iso) {
  return String(iso).slice(0, 10);
}
