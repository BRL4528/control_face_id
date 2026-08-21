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
 * O que fazer quando alguém em cooldown é reconhecido de novo — achado de
 * produção (cliente testou e reclamou): a tela de ponto reabre a câmera
 * sozinha depois do comprovante, e se a pessoa não saiu da frente, o mesmo
 * rosto é reconhecido bem ali e caía direto na mensagem de cooldown — o
 * sistema "acusava falha" em quem tinha acabado de ter sucesso.
 *
 * `null` = não está em cooldown, segue o fluxo normal de confirmação.
 * `'nada'` = está em cooldown E é a mesma pessoa que nunca saiu da frente da
 * câmera desde que marcou aqui — no-op silencioso, sem mensagem nenhuma.
 * `'mensagem'` = está em cooldown por outro motivo (saiu e voltou depois,
 * chegou já em cooldown por marcação de outro aparelho, etc.) — aviso
 * continua útil aqui.
 *
 * `continuaNaFrenteDesdeQueMarcouAqui` é um BOOLEANO, não um prazo: "acabou
 * de marcar" não tem duração fixa — dura o tempo que a pessoa ficar parada
 * ali, e só isso, então quem decide é presença contínua (rastreada por quem
 * chama, a partir do sinal de rosto detectado), nunca um relógio. Um prazo
 * fixo resolveria só o primeiro re-reconhecimento e voltaria a incomodar
 * assim que o prazo vencesse com a pessoa ainda parada na frente — pior que
 * o defeito original, porque pareceria corrigido no teste rápido.
 */
export function decisaoCooldown(pessoaId, marcacoesDoDia, agoraMs, cooldownMs, continuaNaFrenteDesdeQueMarcouAqui) {
  if (!emCooldown(pessoaId, marcacoesDoDia, agoraMs, cooldownMs)) return null;
  return continuaNaFrenteDesdeQueMarcouAqui ? 'nada' : 'mensagem';
}

/**
 * Quais itens saem da fila local depois da resposta do servidor.
 * `aceito` e `duplicado` significam que o servidor tem o registro — some.
 * `retido` também sai daqui: o servidor já gravou (§1.6), só falta revisão
 * do RH — retentar localmente reenviaria pra sempre um item que o servidor
 * não vai aceitar de novo. `rejeitado` é tratado à parte, por `itensRecusados`.
 */
export function itensParaRemover(resultados) {
  return (resultados || [])
    .filter(r => r && (r.status === 'aceito' || r.status === 'duplicado' || r.status === 'retido'))
    .map(r => r.id_cliente);
}

/**
 * `rejeitado` também sai da fila de envio — retentar um lote fabricado ou de
 * pessoa desconhecida nunca vira aceito — mas não é ponto: vai para uma
 * coleção própria (§1.6/§3.3 do contrato), visível, nunca reenviada e nunca
 * apagada sozinha. Separado de `itensParaRemover` porque os dois arquivam em
 * lugares diferentes (enviadas vs. recusadas).
 */
export function itensRecusados(resultados) {
  return (resultados || [])
    .filter(r => r && r.status === 'rejeitado')
    .map(r => r.id_cliente);
}

/**
 * Marcações retidas por aparelho revogado, agrupadas para a mesa do RH —
 * §1.6 do contrato: "Tablet obra norte · revogado em 20/08 18:00 · 14
 * marcações recebidas em 21/08 14:20, batidas entre 20/08 07:02 e
 * 20/08 17:40". Sem a contagem visível o RH não percebe inflação da fila
 * mesmo quando cada linha isolada parece plausível (ameacas-v3.md § Novo 3).
 * Só agrupa `motivo_codigo === 'aparelho_revogado'` — outros motivos
 * (pessoa inativa, por exemplo) são problema de pessoa, não de aparelho, e
 * continuam na lista normal de pendências, um item por vez.
 */
export function retidasPorAparelho(marcacoes) {
  const grupos = {};
  for (const m of (marcacoes || [])) {
    if (!m || !m.pendente || m.motivo_codigo !== 'aparelho_revogado') continue;
    const id = m.aparelho_dispositivo_id || 'desconhecido';
    if (!grupos[id]) {
      grupos[id] = {
        dispositivo_id: id, apelido: m.aparelho_apelido || id,
        revogado_em: m.aparelho_revogado_em || null, itens: []
      };
    }
    grupos[id].itens.push(m);
  }
  return Object.values(grupos).map(g => {
    const batidas = g.itens.map(m => m.marcado_em).filter(Boolean).sort();
    const recebidas = g.itens.map(m => m.recebido_em).filter(Boolean).sort();
    return Object.assign(g, {
      total: g.itens.length,
      batida_min: batidas[0] || null,
      batida_max: batidas[batidas.length - 1] || null,
      recebido_max: recebidas[recebidas.length - 1] || null
    });
  }).sort((a, b) => b.total - a.total);
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
 * Chave de comparação de unidade (§2.4/§8-A): "Unidade A", "unidade a" e
 * "Unidade  A" têm de resolver pra mesma unidade. Só pra COMPARAR — o valor
 * exibido/gravado é sempre o texto original de alguma equipe, nunca esta
 * chave normalizada.
 */
export function normalizarUnidade(bruto) {
  return String(bruto || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/* ------------------------------------------------------------ colaborador */

const TELEFONE_INVALIDO = { ok: false, codigo: 'TELEFONE_INVALIDO', mensagem: 'Telefone inválido', campo: 'telefone' };
const TELEFONE_NAO_MOVEL = {
  ok: false, codigo: 'TELEFONE_NAO_MOVEL', campo: 'telefone',
  mensagem: 'Precisa ser um celular: é por ele que a gente manda o link do cadastro de face.'
};

// DDD (2 dígitos) + 9 dígitos do celular, sem o +55.
function validarCelularBr(onze) {
  if (onze.length !== 11) return TELEFONE_INVALIDO;
  const ddd = onze.slice(0, 2);
  if (ddd.includes('0') || Number(ddd) < 11 || Number(ddd) > 99) return TELEFONE_INVALIDO;
  if (onze[2] !== '9') return TELEFONE_NAO_MOVEL;
  return { ok: true, e164: '+55' + onze, estrangeiro: false };
}

/**
 * Normaliza um telefone bruto para E.164 e classifica o resultado — contrato
 * docs/fase3-contrato.md § 3.1. Compartilhada entre servidor e tela: as duas
 * pontas têm de concordar sobre o que é um celular válido, senão o cliente
 * aceita o que o servidor recusa (ou vice-versa) e alguém descobre tarde.
 */
export function normalizarTelefone(bruto) {
  const limpo = String(bruto == null ? '' : bruto).replace(/[\s\-.()]/g, '');
  if (!limpo) return { ok: false, codigo: 'TELEFONE_OBRIGATORIO', mensagem: 'Telefone é obrigatório', campo: 'telefone' };

  if (limpo.startsWith('+')) {
    const digitos = limpo.slice(1);
    if (!/^\d+$/.test(digitos)) return TELEFONE_INVALIDO;
    if (digitos.startsWith('55')) return validarCelularBr(digitos.slice(2));
    if (digitos.length < 8 || digitos.length > 15) return TELEFONE_INVALIDO;
    return { ok: true, e164: '+' + digitos, estrangeiro: true };
  }

  if (!/^\d+$/.test(limpo)) return TELEFONE_INVALIDO;
  if (limpo.length === 11) return validarCelularBr(limpo);
  if (limpo.length === 13 && limpo.startsWith('55')) return validarCelularBr(limpo.slice(2));
  if (limpo.length === 10 || (limpo.length === 12 && limpo.startsWith('55'))) return TELEFONE_NAO_MOVEL;
  return TELEFONE_INVALIDO;
}

/**
 * Quem mais, entre pessoas ATIVAS, usa o mesmo telefone — derivado na leitura,
 * nunca persistido (§3.1): o estado se cura sozinho quando alguém troca de
 * número ou é inativado, sem ninguém precisar desfazer nada.
 * Devolve um mapa `pessoa_id -> [{pessoa_id, nome}, …]` só para quem compartilha;
 * pessoa sem par não entra no mapa.
 */
export function telefonesCompartilhados(pessoas) {
  const porTelefone = {};
  for (const p of (pessoas || [])) {
    if (!p || !p.ativo || !p.telefone) continue;
    (porTelefone[p.telefone] = porTelefone[p.telefone] || []).push(p);
  }
  const mapa = {};
  for (const grupo of Object.values(porTelefone)) {
    if (grupo.length < 2) continue;
    for (const p of grupo) {
      mapa[p.pessoa_id] = grupo.filter(x => x.pessoa_id !== p.pessoa_id).map(x => ({ pessoa_id: x.pessoa_id, nome: x.nome }));
    }
  }
  return mapa;
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

/**
 * Yaw (giro horizontal da cabeça) a partir de três landmarks do rosto — só
 * `.x`, de propósito (T-5EC67B): pitch (queixo para baixo/cima) é rotação em
 * torno do eixo HORIZONTAL, então mexe em `.y`/`.z`, nunca em `.x`. Esta
 * função é matematicamente cega a pitch — não é limiar frouxo, é ausência de
 * métrica. Função pura (sem DOM) de propósito, para o QA poder afirmar isso
 * em unitário determinístico sem navegador.
 */
export function yaw(landmarks) {
  const p = landmarks.positions;
  const le = p[36], re = p[45], nariz = p[30];
  const meio = (le.x + re.x) / 2;
  const vao = Math.abs(re.x - le.x) || 1;
  return (nariz.x - meio) / vao;
}
