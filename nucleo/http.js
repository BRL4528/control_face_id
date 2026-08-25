// (c) O ADAPTADOR HTTP — parte de cima, sem transporte.
//
// Recebe uma requisicao ja em forma de dado simples e devolve
// `{status, corpo, cabecalhos}`. NAO importa node:http, nao toca socket, nao
// le arquivo. Por isso serve igual para o servidor falso (node:http, via
// nucleo/http-node.js), para uma funcao da Vercel (Request/Response) e para um
// teste que chama despachar() direto, sem subir porta nenhuma.
//
// O que mora aqui e SO o que e do protocolo: achar a rota, aplicar a politica
// de autenticacao dela e escolher a politica de CORS. Regra de negocio nenhuma
// — quem decide e nucleo/casos/*.

import { erroDe } from './contexto.js';

// ===========================================================================
// POLITICAS DE AUTENTICACAO
// ===========================================================================
// Cada rota declara UMA. A politica e do ROTEADOR e nao do caso de uso de
// proposito: rota nova nasce tendo de escolher, em vez de nascer aberta porque
// alguem esqueceu a checagem la dentro.
export const AUTH = {
  /** Sem credencial previa. O proprio corpo/token da rota e a credencial. */
  ABERTA: 'aberta',
  /** Piloto v2 (token de aparelho no corpo) OU aparelho v3 (Bearer). */
  TOKEN_OU_APARELHO: 'token_ou_aparelho',
  /** So aparelho v3: Bearer + dispositivo_id. */
  APARELHO: 'aparelho',
  /** RH: usuario + chave no CORPO (nao usa token de aparelho). */
  RH: 'rh',
  /** Sessao de gestor por face: Bearer de sessao. */
  SESSAO_GESTOR: 'sessao_gestor'
};

// ===========================================================================
// POLITICAS DE CORS
// ===========================================================================
export const CORS = {
  /** `*`. Nenhuma dessas rotas e alcancada de origem alheia hoje. */
  ABERTO: 'aberto',
  /**
   * §4.6/criterio 20: LISTA de origens, nunca `*`, e sem Allow-Credentials —
   * o token do convite viaja em cabecalho, nao em cookie. So as duas rotas da
   * pagina publica de face.
   */
  LISTA_FACE: 'lista_face'
};

export const CABECALHOS_ACEITOS = 'Authorization, Content-Type, Idempotency-Key';

/**
 * Uma rota. `caminho` e comparacao exata — sem regex, sem prefixo: rota que
 * casa por prefixo e como /rh/aparelho/aprovar e /rh/aparelho viram a mesma
 * coisa sem ninguem perceber.
 * @typedef {{caminho: string, metodos?: string[], auth: string, cors?: string, manipulador: Function}} Rota
 */

export function criarRoteador(rotas) {
  const porCaminho = new Map();
  for (const rota of rotas) {
    if (porCaminho.has(rota.caminho)) throw new Error('rota duplicada: ' + rota.caminho);
    porCaminho.set(rota.caminho, rota);
  }
  return {
    achar: caminho => porCaminho.get(caminho) || null,
    caminhos: () => [...porCaminho.keys()]
  };
}

/**
 * Autentica conforme a politica da rota e enriquece `req` com quem ficou
 * provado (dispositivo, rh, sessaoGestor).
 * @returns {Promise<{ok: true, req: object} | {ok: false, resposta: object}>}
 */
export async function autenticar(ctx, req, rota) {
  const erro = erroDe(ctx.cripto);

  if (rota.auth === AUTH.ABERTA) return { ok: true, req };

  if (rota.auth === AUTH.RH) {
    const usuario = await ctx.repo.lerUsuarioRh(req.corpo.usuario);
    // ADAPTADOR SEM O CAMPO `chave` NAO E SENHA ERRADA -- e contrato violado, e
    // tem de dizer isso. Com `usuario.chave` undefined, a comparacao abaixo e
    // sempre verdadeira e TODO login de RH devolve 401 "usuario ou senha
    // invalidos": indistinguivel de senha errada, com a senha certa, a semente
    // certa e a linha gravada certa. Custou tres das oito rotas na vespera do
    // teste, e o 401 mandou procurar no lugar errado.
    //
    // RESSALVA QUE EU NAO ESCONDO, e e do QA julgar: 503 aqui distingue
    // "usuario existe e o adaptador esta quebrado" de "usuario nao existe", e
    // isso e um oraculo estreito de enumeracao. Aceitei porque a condicao so
    // ocorre quando o adaptador nao devolve chave para NINGUEM -- ou seja,
    // durante queda total do login de RH, quando nao ha login a proteger, e o
    // diagnostico e o que encerra a queda. Discordando, o conserto e trocar por
    // 401 e deixar so o console.error: reversao de uma linha.
    if (usuario && usuario.chave == null) {
      console.error('[api] lerUsuarioRh devolveu usuario SEM o campo `chave`. ' +
        'O campo do contrato e `chave` (nucleo/repositorio.js); a coluna pode ' +
        'se chamar chave_hash e o adaptador apelida na saida.');
      return { ok: false, resposta: { status: 503,
        corpo: erro('ADAPTADOR_SEM_CHAVE_RH', 'a origem nao consegue conferir credencial de RH') } };
    }
    if (!usuario || req.corpo.chave !== usuario.chave) {
      // Corpo TEXTUAL, nao o objeto de erro do contrato: e o formato que o
      // painel do RH ja espera. Trocar aqui e mudanca de contrato, nao de
      // implementacao.
      return { ok: false, resposta: { status: 401, corpo: { ok: false, erro: 'usuario ou senha invalidos' } } };
    }
    return { ok: true, req: Object.assign({}, req, { rh: usuario }) };
  }

  if (rota.auth === AUTH.SESSAO_GESTOR) {
    const sessao = await ctx.repo.lerSessaoGestor(req.credencial, req.agoraMs);
    if (!sessao) return { ok: false, resposta: { status: 401, corpo: erro('SESSAO_EXPIRADA', 'sessao expirada') } };
    return { ok: true, req: Object.assign({}, req, { sessaoGestor: sessao }) };
  }

  const dispositivo = await autenticarAparelho(ctx, req);

  if (rota.auth === AUTH.APARELHO) {
    if (!dispositivo) return { ok: false, resposta: { status: 401, corpo: erro('CREDENCIAL_INVALIDA', 'credencial invalida') } };
    return { ok: true, req: Object.assign({}, req, { dispositivo }) };
  }

  if (rota.auth === AUTH.TOKEN_OU_APARELHO) {
    const token = req.corpo.token || req.tokenDaQuery || '';
    if (token !== ctx.cfg.tokenLegado && !dispositivo) {
      // Compatibilidade do piloto: o cliente v2 ainda espera `erro` textual
      // quando ELE mandou um token. Quem nao mandou token nenhum e cliente v3
      // e recebe o corpo de erro do contrato.
      if (token) return { ok: false, resposta: { status: 401, corpo: { ok: false, erro: 'token invalido' } } };
      return { ok: false, resposta: { status: 401, corpo: erro('CREDENCIAL_INVALIDA', 'credencial invalida') } };
    }
    return { ok: true, req: Object.assign({}, req, { dispositivo }) };
  }

  throw new Error('politica de autenticacao desconhecida: ' + rota.auth);
}

/**
 * Bearer + dispositivo_id. Toda chamada autenticada de aparelho conta como
 * "uso" — e o que a aba Aparelhos mostra como "ultimo uso".
 * @returns {Promise<object|null>} a linha do aparelho, ou null.
 */
export async function autenticarAparelho(ctx, req) {
  if (!req.corpo.dispositivo_id || !req.credencial) return null;
  const dispositivo = await ctx.repo.lerDispositivo(req.corpo.dispositivo_id);
  if (!dispositivo || dispositivo.credencial_hash !== ctx.cripto.sha256(req.credencial)) return null;
  await ctx.repo.marcarUsoDispositivo(dispositivo.dispositivo_id, req.agoraIso);
  return dispositivo;
}

/**
 * Ponto de entrada. Rota inexistente e 404 com o corpo que o contrato ja usa.
 * @returns {Promise<{status: number, corpo: object, cabecalhos?: object, rota?: Rota}>}
 */
export async function despachar(ctx, roteador, req) {
  const rota = roteador.achar(req.caminho);
  if (!rota) return { status: 404, corpo: { ok: false, erro: 'rota desconhecida' } };
  if (rota.metodos && !rota.metodos.includes(req.metodo)) {
    return { status: 405, corpo: erroDe(ctx.cripto)('METODO_NAO_PERMITIDO', 'metodo nao permitido'), rota };
  }
  const auth = await autenticar(ctx, req, rota);
  if (!auth.ok) return Object.assign({}, auth.resposta, { rota });
  const resposta = await rota.manipulador(ctx, auth.req);
  return Object.assign({}, resposta, { rota });
}

// ===========================================================================
// CORS  —  calculo puro, aplicado por quem escreve a resposta
// ===========================================================================

/**
 * @param {string} politica  CORS.ABERTO | CORS.LISTA_FACE
 * @param {string|undefined} origemPedida  cabecalho Origin da requisicao
 * @param {(origem: string) => boolean} origemPermitida  so usado na LISTA_FACE
 */
export function cabecalhosDeCors(politica, origemPedida, origemPermitida) {
  const base = { 'Access-Control-Allow-Headers': CABECALHOS_ACEITOS };
  if (politica === CORS.LISTA_FACE) {
    // Sem Origin permitida NAO devolve cabecalho nenhum — o navegador recusa,
    // que e o comportamento certo. Devolver `*` "para nao quebrar" seria
    // abrir a rota do convite para qualquer origem.
    if (origemPedida && origemPermitida && origemPermitida(origemPedida)) {
      base['Access-Control-Allow-Origin'] = origemPedida;
    }
    return base;
  }
  base['Access-Control-Allow-Origin'] = '*';
  return base;
}

/** Resposta do preflight. 204 e sem corpo, sempre. */
export function respostaDePreflight(politica, origemPedida, origemPermitida) {
  const cabecalhos = Object.assign(
    cabecalhosDeCors(politica, origemPedida, origemPermitida),
    politica === CORS.LISTA_FACE
      ? { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' }
      : { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
  );
  return { status: 204, corpo: null, cabecalhos };
}
