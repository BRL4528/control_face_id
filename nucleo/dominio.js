// (a) O NUCLEO PURO — dominio e regras. Sem HTTP, sem armazenamento, sem
// relogio proprio, sem aleatoriedade propria.
//
// Toda funcao aqui decide a partir do que recebe e devolve o que decidiu.
// `agoraMs` sempre entra por parametro: nada aqui chama Date.now(), para que
// a regra seja testavel sem congelar relogio e para que a API e o servidor
// falso nunca discordem por causa de dois relogios diferentes.
//
// As funcoes puras COMPARTILHADAS com o cliente continuam morando em js/ e sao
// so reexportadas daqui: avaliarLoteFace (coerencia das 3 fotos),
// normalizarTelefone, telefonesCompartilhados, normalizarUnidade. Copia propria
// e como o bug de T-8ADD9C so mudaria de lugar.
export { avaliarLoteFace } from '../js/coerencia.js';
export {
  normalizarTelefone, telefonesCompartilhados, normalizarUnidade, euclidiana
} from '../js/regras.js';

import { euclidiana } from '../js/regras.js';

// ===========================================================================
// MARCACAO — quem entra, quem fica retido, quem e rejeitado
// ===========================================================================

// T-D00CE0 (docs/fase3-contrato.md §1.6 e §3.3.3).
export const JANELA_DRENAGEM_MS = 30 * 24 * 3600 * 1000;
export const TETO_RETIDAS_POS_REVOGACAO = 500;

/** null = segue o fluxo normal (aparelho ativo). Senao, {status, motivo_codigo}. */
export function resultadoPorEstadoAparelho(dispositivo, agoraMs) {
  if (!dispositivo || dispositivo.estado === 'pendente' || dispositivo.estado === 'negado') {
    return { status: 'rejeitado', motivo_codigo: 'aparelho_nunca_liberado' };
  }
  if (dispositivo.estado === 'ativo') return null;
  if (dispositivo.estado === 'revogado') {
    const desde = Date.parse(dispositivo.revogado_em);
    if (isFinite(desde) && (agoraMs - desde) > JANELA_DRENAGEM_MS) {
      return { status: 'rejeitado', motivo_codigo: 'janela_de_drenagem_encerrada' };
    }
    if ((dispositivo.retidasPosRevogacao || 0) >= TETO_RETIDAS_POS_REVOGACAO) {
      return { status: 'rejeitado', motivo_codigo: 'limite_pos_revogacao' };
    }
    return { status: 'retido', motivo_codigo: 'aparelho_revogado' };
  }
  return { status: 'rejeitado', motivo_codigo: 'aparelho_nunca_liberado' };
}

/**
 * null = segue o fluxo normal (pessoa ativa e conhecida). `pessoa` precisa
 * trazer `.ativo` e `.inativado_em` ja resolvidos — a funcao nao sabe de
 * lista de inativos, so decide a partir do que recebe.
 */
export function resultadoPorEstadoPessoa(pessoa, marcadoEmIso) {
  if (!pessoa) return { status: 'rejeitado', motivo_codigo: 'pessoa_desconhecida' };
  if (pessoa.ativo === false) {
    const inativadoEm = Date.parse(pessoa.inativado_em);
    const marcadoEm = Date.parse(marcadoEmIso);
    if (isFinite(inativadoEm) && isFinite(marcadoEm) && marcadoEm < inativadoEm) {
      return { status: 'retido', motivo_codigo: 'pessoa_inativa_no_envio' };
    }
    return { status: 'rejeitado', motivo_codigo: 'pessoa_inativa' };
  }
  return null;
}

// Frase de gente para cada motivo_codigo — o cliente escolhe por CODIGO
// (§1.6); isto e so o texto que a rota devolve pronto.
export const FRASES_MOTIVO = {
  aparelho_revogado: 'Aparelho revogado: o RH vai conferir esta marcação.',
  janela_de_drenagem_encerrada: 'Aparelho revogado há mais de 30 dias: este ponto não é mais aceito.',
  limite_pos_revogacao: 'Muitas marcações deste aparelho depois da revogação: este ponto não é mais aceito.',
  aparelho_nunca_liberado: 'Este aparelho nunca foi liberado pelo RH.',
  pessoa_inativa_no_envio: 'Colaborador foi inativado depois desta marcação: o RH vai conferir.',
  pessoa_inativa: 'Colaborador está inativo: este ponto não é aceito.',
  pessoa_desconhecida: 'Colaborador não encontrado no cadastro.'
};

export const DERIVA_TOLERADA_MS = 120000;

/**
 * Gestor, marcacao manual, veredito diferente de aceito ou relogio fora de 2
 * minutos vao para a mesa do RH. Mesma regra do workflow real.
 */
export function exigeRevisaoDoRh(marcacao, pessoa) {
  const deriva = marcacao.deriva_relogio_ms == null ? 0 : Number(marcacao.deriva_relogio_ms);
  return marcacao.veredito !== 'aceito'
    || marcacao.origem === 'manual'
    || (pessoa && pessoa.papel === 'gestor')
    || Math.abs(deriva) > DERIVA_TOLERADA_MS;
}

/** Campos obrigatorios de uma marcacao no lote. */
export function marcacaoTemCamposObrigatorios(m) {
  return !!(m && m.id_cliente && m.pessoa_id && m.marcado_em);
}

/** Estado do dia de uma pessoa, a partir das marcacoes dela naquele dia. */
export function estadoDoDia(marcacoesDoDia) {
  const ordenadas = [...marcacoesDoDia]
    .sort((a, b) => String(a.marcado_em).localeCompare(String(b.marcado_em)));
  const ultima = ordenadas.at(-1);
  if (!ultima) return { estado: 'ausente', ultima: null };
  return { estado: ultima.tipo === 'intervalo' ? 'em_intervalo' : 'em_jornada', ultima };
}

// ===========================================================================
// APARELHO — codigo curto, prova de posse, resumo de UA
// ===========================================================================

// O e O nunca entram: sao as confusoes de leitura que a pessoa comete olhando
// a tela do aparelho e digitando na tela do RH.
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LETRAS_NUNCA_USADAS = 'OIL01';
export const TAMANHO_CODIGO = 6;

/**
 * Normalizacao (§1.3): caixa alta, formatacao (traco/espaco) fora do alfabeto
 * e descartada. Letra que o alfabeto nunca usa e SEMPRE erro de digitacao —
 * checagem ESTATICA da string, antes de qualquer busca, porque nao conta nada
 * sobre se aquele codigo ja existiu (achado do QA: nao pode virar oraculo).
 *
 * @returns {{ok: true, codigo: string} | {ok: false, motivo: 'letra_invalida'}}
 */
export function normalizarCodigoCurto(bruto) {
  const semFormatacao = String(bruto || '').toUpperCase().replace(/[\s-]+/g, '');
  if (/[^A-Z0-9]/.test(semFormatacao) || [...semFormatacao].some(c => LETRAS_NUNCA_USADAS.includes(c))) {
    return { ok: false, motivo: 'letra_invalida' };
  }
  return { ok: true, codigo: semFormatacao };
}

/** Prova de posse nao vale para sempre: depois da janela, o codigo caduca. */
export function codigoExpirado(dispositivo, agoraMs, expiraEmMs) {
  return !dispositivo.criado_em || (agoraMs - Date.parse(dispositivo.criado_em)) > expiraEmMs;
}

/**
 * Resumo leve de UA para a tela do RH (§1.2 `ua_resumida`). Nao e parser
 * completo: so o suficiente para distinguir "Chrome 141 · Android 14" de
 * "Safari · iOS". UA que nao casa nenhum padrao volta como veio, truncada, em
 * vez de ganhar rotulo inventado.
 */
export function resumirUa(ua) {
  const texto = String(ua || '');
  const nav = texto.match(/(Chrome|Firefox|Edg|OPR|Safari)\/(\d+)/);
  const so =
    texto.match(/Android\s*([\d.]+)/) ? 'Android ' + texto.match(/Android\s*([\d.]+)/)[1] :
    texto.match(/iPhone OS ([\d_]+)/) ? 'iOS ' + texto.match(/iPhone OS ([\d_]+)/)[1].replace(/_/g, '.') :
    texto.match(/Windows NT ([\d.]+)/) ? 'Windows' :
    texto.match(/Mac OS X/) ? 'macOS' :
    texto.match(/Linux/) ? 'Linux' : null;
  const nomeNav = nav && (nav[1] === 'Edg' ? 'Edge' : nav[1] === 'OPR' ? 'Opera' : nav[1]);
  if (!nomeNav && !so) return texto.slice(0, 60);
  return [nomeNav && (nomeNav + ' ' + nav[2]), so].filter(Boolean).join(' · ');
}

// §1.3 LIMITE_APROVACAO: contagem por USUARIO de RH, nao por aparelho — e
// sobre alguem tentando adivinhar codigo, nao sobre um aparelho especifico.
export const JANELA_LIMITE_APROVACAO_MS = 5 * 60 * 1000;
export const LIMITE_APROVACAO_TENTATIVAS = 10;

/** Segundos de Retry-After a partir da tentativa mais antiga ainda na janela. */
export function segundosAteLiberar(instantes, janelaMs, agoraMs) {
  if (!instantes.length) return 1;
  const maisAntiga = Math.min(...instantes);
  return Math.max(1, Math.ceil((janelaMs - (agoraMs - maisAntiga)) / 1000));
}

// ===========================================================================
// CONVITE DE FACE (§4.4)
// ===========================================================================

export const LIMITE_ENVIOS_RECUSADOS = 5;
export const ESTADOS_CONVITE_VIVO = ['emitido', 'aberto'];

/**
 * Expiracao e computada NA LEITURA — nunca gravada por um timer de fundo.
 * (No repositorio ela vira clausula do UPDATE; aqui e so a leitura.)
 */
export function estadoEfetivoConvite(convite, agoraMs) {
  if (!convite) return null;
  if (ESTADOS_CONVITE_VIVO.includes(convite.estado) && agoraMs > Date.parse(convite.expira_em)) {
    return 'expirado';
  }
  return convite.estado;
}

/** (11) 9****-1111 — o RH confere o numero sem o numero aparecer inteiro. */
export function mascararTelefone(e164) {
  const m = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(String(e164 || ''));
  return m ? '(' + m[1] + ') ' + m[2][0] + '****-' + m[3] : e164;
}

export function primeiroNome(nome) {
  return nome ? String(nome).split(' ')[0] : '';
}

// ===========================================================================
// MODELO BIOMETRICO OBSERVADO (§4.7)
// ===========================================================================

/**
 * Classifica um modelo_id contra a referencia ANTERIOR a esta observacao —
 * quem chama registra a observacao DEPOIS, senao "conhecido" fica sempre
 * verdadeiro porque o proprio registro que acabou de acontecer ja conta.
 *
 * Sem referencia nenhuma (nenhum /efrat/carga reportou), nao ha contra o que
 * comparar: `modelo_desconhecido`, a categoria conservadora — grava e
 * sinaliza, nunca recusa.
 */
export function classificarModelo(modeloId, referenciaAnterior, jaConhecido) {
  if (referenciaAnterior == null) return { modelo_divergente: false, modelo_desconhecido: true };
  if (modeloId === referenciaAnterior) return { modelo_divergente: false, modelo_desconhecido: false };
  return { modelo_divergente: !!jaConhecido, modelo_desconhecido: !jaConhecido };
}

// ===========================================================================
// IDENTIFICACAO
// ===========================================================================

export const DIMENSAO_DESCRITOR = 128;

export function descritorValido(descritor) {
  return Array.isArray(descritor)
    && descritor.length === DIMENSAO_DESCRITOR
    && !descritor.some(v => !Number.isFinite(v));
}

/**
 * Ranking por menor distancia entre o descritor e QUALQUER vetor da pessoa.
 * @returns {{pessoa: object, distancia: number}[]} crescente por distancia.
 */
export function ranquearPessoas(descritor, pessoas) {
  return pessoas
    .map(p => ({ pessoa: p, distancia: Math.min(...(p.vetores || []).map(v => euclidiana(descritor, v))) }))
    .sort((a, b) => a.distancia - b.distancia);
}

// ===========================================================================
// VALIDACOES DE CADASTRO
// ===========================================================================

export function nomeDeEquipeValido(nome) {
  return !!nome && nome.length >= 2 && nome.length <= 60;
}

export function motivoValido(bruto, minimo, maximo) {
  const motivo = String(bruto || '').trim();
  return motivo.length >= minimo && motivo.length <= maximo;
}

export const ACOES_DE_AJUSTE = ['incluir_marcacao', 'alterar_marcacao', 'excluir_marcacao'];

export function ajusteDeGestorValido(corpo) {
  return ACOES_DE_AJUSTE.includes(corpo.acao) && String(corpo.motivo || '').trim().length >= 10;
}

// Campos que a escrita NUNCA aceita (§3.2): derivados e imutaveis.
export const CAMPOS_DERIVADOS_DE_PESSOA = [
  'tem_biometria', 'sem_equipe', 'miniatura', 'telefone_compartilhado', 'telefone_compartilhado_com'
];

export function dataLocalValida(bruto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(bruto || ''));
}

export function dia(iso) {
  return String(iso).slice(0, 10);
}
