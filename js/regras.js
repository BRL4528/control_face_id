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

/* ---------------------------------------------------- painel do RH */

/** Indicadores do período, calculados no cliente a partir do que /rh/dados devolve. */
export function indicadores(marcacoes, pessoas, equipes) {
  const ms = marcacoes || [];
  const ativos = (pessoas || []).filter(p => p.ativo);
  const porEquipe = {};
  for (const e of (equipes || [])) {
    porEquipe[e.equipe_id] = {
      equipe_id: e.equipe_id, nome: e.nome, pessoas: 0,
      marcacoes: 0, manuais: 0, cinzentas: 0, pendentes: 0, taxa_manual: 0
    };
  }
  for (const p of ativos) if (porEquipe[p.equipe_id]) porEquipe[p.equipe_id].pessoas++;
  for (const m of ms) {
    const g = porEquipe[m.equipe_id];
    if (!g) continue;
    g.marcacoes++;
    if (m.origem === 'manual') g.manuais++;
    if (m.veredito === 'revisar') g.cinzentas++;
    if (m.pendente) g.pendentes++;
  }
  const lista = Object.keys(porEquipe).map(k => porEquipe[k]);
  for (const g of lista) {
    g.taxa_manual = g.marcacoes === 0 ? 0 : Math.round((g.manuais / g.marcacoes) * 1000) / 10;
  }
  lista.sort((a, b) => b.taxa_manual - a.taxa_manual);
  return {
    equipes: lista,
    total: ms.length,
    manuais: ms.filter(m => m.origem === 'manual').length,
    cinzentas: ms.filter(m => m.veredito === 'revisar').length,
    pendentes: ms.filter(m => m.pendente).length,
    semBiometria: ativos.filter(p => !p.tem_biometria).length,
    taxaManual: ms.length === 0 ? 0 : Math.round((ms.filter(m => m.origem === 'manual').length / ms.length) * 1000) / 10
  };
}

/** Espelho de ponto de uma pessoa: um dia por linha, com os pares na ordem. */
export function espelho(marcacoes, pessoaId) {
  const dias = {};
  for (const m of (marcacoes || [])) {
    if (m.pessoa_id !== pessoaId) continue;
    (dias[m.marcado_dia] = dias[m.marcado_dia] || []).push(m);
  }
  return Object.keys(dias).sort().reverse().map(d => ({
    dia: d,
    marcacoes: dias[d].slice().sort((a, b) => String(a.marcado_em).localeCompare(String(b.marcado_em)))
  }));
}

/** O gestor precisa registrar o próprio ponto ao abrir a fila? */
export function gestorDeveMarcar(marcacoesDoGestorHoje, agoraMs, cooldownMs) {
  const ms = marcacoesDoGestorHoje || [];
  if (ms.length === 0) return true;
  const ultima = ms.slice().sort((a, b) => String(b.marcado_em).localeCompare(String(a.marcado_em)))[0];
  return (agoraMs - Date.parse(ultima.marcado_em)) >= cooldownMs;
}

/* ---------------------------------------------- painel desktop do RH */

// Limiares padrão de presença. Espelham window.EFRAT_CFG.limiarPresenca, mas
// ficam aqui para a função pura rodar em Node sem depender do config do browser.
export const LIMIAR_PRESENCA = { bom: 0.95, atencao: 0.85, serio: 0.70 };

/**
 * Presença de cada equipe HOJE. Presença é gente que apareceu, não horário:
 * sem escala cadastrada, quem não marcou hoje conta como ausente.
 *
 *   esperados = pessoas ativas da equipe, gestor incluído
 *   presentes = quantos desses têm ≥ 1 marcação com marcado_dia == hoje
 *
 * Equipe sem esperados não vira card (não há o que cobrar). Equipe com
 * esperados e zero presentes é presenca 0 — o caso que o RH precisa ver.
 * `hoje` entra como parâmetro ('YYYY-MM-DD') para a função ser testável.
 */
export function presencaPorEquipe(pessoas, marcacoes, equipes, hoje) {
  const ativos = (pessoas || []).filter(p => p && p.ativo);
  const presentesPorEquipe = {};
  const nomesPresentes = {};
  for (const m of (marcacoes || [])) {
    if (!m || m.marcado_dia !== hoje) continue;
    (nomesPresentes[m.equipe_id] = nomesPresentes[m.equipe_id] || new Set()).add(m.pessoa_id);
  }
  for (const k of Object.keys(nomesPresentes)) presentesPorEquipe[k] = nomesPresentes[k];

  return (equipes || []).map(e => {
    const doTime = ativos.filter(p => p.equipe_id === e.equipe_id);
    const esperados = doTime.length;
    const marcaram = presentesPorEquipe[e.equipe_id] || new Set();
    const presentes = doTime.filter(p => marcaram.has(p.pessoa_id)).length;
    const ausentes = doTime.filter(p => !marcaram.has(p.pessoa_id)).map(p => p.nome || p.pessoa_id);
    const presenca = esperados === 0 ? null : presentes / esperados;
    return {
      equipe_id: e.equipe_id, nome: e.nome,
      esperados, presentes, presenca,
      ausentes,
      status: presenca == null ? null : statusPresenca(presenca, LIMIAR_PRESENCA)
    };
  }).filter(c => c.esperados > 0)
    .sort((a, b) => a.presenca - b.presenca);   // pior primeiro
}

/**
 * Degrau de status a partir da taxa de presença. Quatro degraus fixos, nunca
 * uma rampa contínua. Os limiares são inclusivos por baixo: exatamente 0,95 é
 * `bom`, exatamente 0,85 é `atencao` — é a borda onde o >= costuma errar.
 */
export function statusPresenca(taxa, limiares) {
  const L = limiares || LIMIAR_PRESENCA;
  if (taxa >= L.bom) return 'bom';
  if (taxa >= L.atencao) return 'atencao';
  if (taxa >= L.serio) return 'serio';
  return 'critico';
}

/**
 * Série de contagens por dia, para o gráfico de linha. Preenche todo dia do
 * período com zero, mesmo os sem marcação — senão a linha liga dois pontos
 * distantes como se o intervalo fosse contínuo, e o gráfico mente.
 *
 * `hoje` ('YYYY-MM-DD') é o último dia; devolve `dias` posições terminando nele.
 * Separa biometria de manual para quem quiser duas linhas; `total` serve à única.
 */
export function serieDiaria(marcacoes, dias, hoje) {
  const n = Math.max(1, dias || 30);
  const fim = Date.parse(hoje + 'T00:00:00Z');
  const dia1 = 86400000;
  const rotulos = [];
  const indice = {};
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(fim - i * dia1).toISOString().slice(0, 10);
    indice[d] = rotulos.length;
    rotulos.push(d);
  }
  const total = rotulos.map(() => 0);
  const biometria = rotulos.map(() => 0);
  const manual = rotulos.map(() => 0);
  for (const m of (marcacoes || [])) {
    const i = indice[m && m.marcado_dia];
    if (i == null) continue;
    total[i]++;
    if (m.origem === 'manual') manual[i]++; else biometria[i]++;
  }
  return { dias: rotulos, total, biometria, manual };
}

/**
 * Aparelhos da aba "Aparelhos" (T-87615C), separados em duas filas e cada uma
 * ordenada para quem decide primeiro: pendentes do mais antigo para o mais
 * novo — é quem está esperando há mais tempo — e aprovados do uso mais
 * recente para o mais antigo, para achar rápido um aparelho esquecido ligado.
 * Aparelho sem `ultimo_uso` (nunca chamou a API depois de aprovado) vai para
 * o fim da lista de aprovados, não para o topo.
 */
export function separarAparelhos(dispositivos) {
  const lista = dispositivos || [];
  const pendentes = lista.filter(d => d && d.estado === 'pendente')
    .slice().sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  const aprovados = lista.filter(d => d && d.estado === 'ativo')
    .slice().sort((a, b) => String(b.ultimo_uso || '').localeCompare(String(a.ultimo_uso || '')));
  return { pendentes, aprovados };
}

/**
 * Pendências agrupadas por motivo, para as barras. Uma mesma marcação pode
 * disparar mais de um motivo (manual E relógio fora): conta em cada um, então
 * a soma das barras pode passar do número de pendências. É de propósito — cada
 * barra responde "quantas pendências têm ESTE problema".
 */
export function pendenciasPorMotivo(marcacoes, recadastros, pessoas) {
  const papel = {};
  for (const p of (pessoas || [])) papel[p.pessoa_id] = p.papel;
  const c = { cinza: 0, manual: 0, gestor: 0, relogio: 0, recadastro: 0 };
  for (const m of (marcacoes || [])) {
    if (!m || !m.pendente) continue;
    if (m.veredito === 'revisar') c.cinza++;
    if (m.origem === 'manual') c.manual++;
    if (papel[m.pessoa_id] === 'gestor') c.gestor++;
    if (Math.abs(Number(m.deriva_relogio_ms) || 0) > 120000) c.relogio++;
  }
  c.recadastro = (recadastros || []).length;
  return [
    { chave: 'cinza', rotulo: 'Zona cinzenta', total: c.cinza },
    { chave: 'manual', rotulo: 'Registro manual', total: c.manual },
    { chave: 'gestor', rotulo: 'Ponto do gestor', total: c.gestor },
    { chave: 'relogio', rotulo: 'Relógio fora', total: c.relogio },
    { chave: 'recadastro', rotulo: 'Recadastro', total: c.recadastro }
  ].sort((a, b) => b.total - a.total);
}
