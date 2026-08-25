// (c) O ADAPTADOR HTTP — o IRMAO de nucleo/http-node.js, para a Vercel.
//
// nucleo/http-node.js diz, no proprio cabecalho, que trocar de transporte e
// "escrever um irmao deste arquivo -- nao e mexer em regra nenhuma". Este e o
// irmao. Ele nao contem uma linha de regra de negocio: acha a rota, decide
// CORS, traduz requisicao e resposta. Quem decide e nucleo/casos/*.
//
// ELE E A JUNTA. E junta e onde ninguem olha: em 25/08 as 8 rotas do primeiro
// turno responderam 404 em preview e em producao com QUATRO medicoes verdes por
// baixo (casos de uso chamados direto, fumaca in-process, adaptador contra
// Postgres, e /api/saude devolvendo banco:ok). Todas honestas, nenhuma
// atravessando a Vercel. Por isso os comentarios daqui sao sobre o que a
// PLATAFORMA faz, nao sobre o que o contrato pede -- e o que a plataforma faz
// que nao esta escrito em lugar nenhum e o que derrubou a junta.

import { despachar, cabecalhosDeCors, respostaDePreflight, CORS } from './http.js';

/**
 * ARMADILHA 1 — o corpo pode JA TER SIDO LIDO.
 *
 * nucleo/http-node.js consome o stream (`for await (const p of req)`). Numa
 * Function da Vercel isso pode devolver VAZIO, porque a plataforma costuma
 * parsear JSON e entregar em `req.body` -- o stream ja acabou. O sintoma e
 * cruel: corpo `{}` em toda rota, logo `dispositivo_id` ausente, logo 401 em
 * tudo. Ou seja: identico ao P0 da manha de 25/08 ("nenhum aparelho se
 * registra"), mas por outra causa. Entao: se `req.body` existe, ele MANDA.
 *
 * @returns {Promise<{corpo: object, bruto: string}>}
 */
export async function lerCorpo(req) {
  if (req.body != null && req.body !== '') {
    if (typeof req.body === 'string') {
      try { return { corpo: JSON.parse(req.body), bruto: req.body }; }
      catch { return { corpo: {}, bruto: req.body }; }
    }
    if (typeof req.body === 'object') {
      // Buffer chega como objeto: trata como texto, nao como corpo pronto.
      if (Buffer.isBuffer(req.body)) {
        const texto = req.body.toString('utf8');
        try { return { corpo: JSON.parse(texto), bruto: texto }; }
        catch { return { corpo: {}, bruto: texto }; }
      }
      return { corpo: req.body, bruto: JSON.stringify(req.body) };
    }
  }
  let bruto = '';
  try { for await (const pedaco of req) bruto += pedaco; } catch { /* stream fechado */ }
  let corpo = {};
  try { corpo = bruto ? JSON.parse(bruto) : {}; } catch { /* corpo vazio */ }
  return { corpo, bruto };
}

/**
 * ARMADILHA 2 — o caminho que a Function ve NAO e o que o cliente pediu.
 *
 * O cliente chama `/webhook/efrat/marcacoes` (js/config.js:24 termina em
 * `/webhook`, e o portao do QA bate nesse caminho literal). O roteador do
 * nucleo registra `/efrat/marcacoes`, SEM prefixo -- igual ao servidor falso,
 * que faz `url.pathname.replace('/webhook', '')`. E a Vercel, depois de um
 * rewrite, entrega a Function o caminho de DESTINO e nao o de origem.
 *
 * Entao a resolucao aceita as tres formas, na ordem, e nao depende de qual
 * roteamento o DevOps escolher:
 *   1. `?rota=` na query -- o rewrite pode carregar o caminho explicitamente
 *      (`/webhook/(.*)` -> `/api/roteador?rota=$1`), que e a forma que nao
 *      depende de nenhum cabecalho interno da plataforma;
 *   2. `x-vercel-original-path` / `x-forwarded-uri`, quando a plataforma manda;
 *   3. o proprio `req.url`.
 * Depois disso, tira os prefixos conhecidos. Prefixo que sobra e 404 -- e 404
 * aqui e exatamente o defeito que este arquivo existe para nao ter.
 */
export function resolverCaminho(req, prefixos) {
  const cru = String(req.url || '/');
  const query = cru.includes('?') ? cru.slice(cru.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);

  let caminho = params.get('rota')
    || req.headers['x-vercel-original-path']
    || req.headers['x-forwarded-uri']
    || cru;

  caminho = String(caminho).split('?')[0];
  if (!caminho.startsWith('/')) caminho = '/' + caminho;

  for (const prefixo of prefixos) {
    if (caminho === prefixo) { caminho = '/'; break; }
    if (caminho.startsWith(prefixo + '/')) { caminho = caminho.slice(prefixo.length); break; }
  }
  return { caminho, tokenDaQuery: params.get('token') || '' };
}

/** O IP de quem chamou, atras do proxy da Vercel. */
export function ipDaRequisicao(req) {
  const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return encaminhado || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

/**
 * Monta o handler. `montarContexto` e chamado UMA vez, na primeira requisicao,
 * e o resultado fica em cache -- construir repositorio por requisicao abriria
 * conexao por requisicao.
 *
 * ARMADILHA 3 — falha de construcao. `verificarRepositorio` lanca na
 * construcao de proposito (interface incompleta falha na hora, nao na
 * requisicao que cair no buraco). Numa Function, lancar no escopo do modulo da
 * 500 opaco. Aqui a falha vira 503 com CODIGO, e o detalhe do erro fica no log
 * e NUNCA na resposta: mensagem de driver vaza host e usuario.
 *
 * @param {object} p
 * @param {() => Promise<{repo, cripto, cfg}>} p.montarContexto
 * @param {object} [p.roteador]        de criarRoteador(), se ja estiver pronto
 * @param {() => Promise<object>} [p.obterRoteador]  para tabela carregada em
 *   tempo de execucao (a copia de build pode nao estar la; ver lib/rotas.js)
 * @param {string[]} [p.prefixos]      prefixos a remover do caminho
 * @param {(req, prefixos) => {caminho: string, tokenDaQuery: string}} [p.resolverCaminho]
 *   quem sabe como o caminho chegou. O padrao fareja `?rota=`, cabecalhos e
 *   req.url; quem tem contrato de rewrite proprio injeta o seu.
 * @param {() => string[]} [p.origensPermitidas]  allowlist de CORS (da env)
 * @param {(e: Error) => object|null} [p.mapearErro]  erro de dominio -> resposta
 */
export function criarManipuladorVercel({
  montarContexto, roteador, obterRoteador,
  prefixos = ['/webhook', '/api/roteador', '/api'],
  resolverCaminho: resolver = resolverCaminho,
  origensPermitidas = () => [], mapearErro = () => null
}) {
  if (!roteador && !obterRoteador) throw new Error('criarManipuladorVercel: falta roteador ou obterRoteador');
  let contexto = null;
  let falhaDeMontagem = null;
  const acharRoteador = obterRoteador || (async () => roteador);

  async function obterContexto() {
    if (contexto) return contexto;
    if (falhaDeMontagem) throw falhaDeMontagem;
    try {
      contexto = await montarContexto();
      return contexto;
    } catch (e) {
      falhaDeMontagem = e;   // nao tenta de novo a cada requisicao
      throw e;
    }
  }

  return async function manipulador(req, res) {
    // Resolvedor injetado que nao sabe responder (rewrite fora do ar, chamada
    // direta) cai no farejador padrao em vez de estourar. Fallback explicito e
    // nao `||` solto: quem injeta precisa poder dizer "nao sei" sem quebrar.
    const resolvido = resolver(req, prefixos) || resolverCaminho(req, prefixos);
    const { caminho, tokenDaQuery } = resolvido;
    // O caminho CRU, antes de tirar prefixo. Ele vai no corpo do 404 junto com
    // o normalizado de proposito: quando os dois divergem, a divergencia E o
    // defeito (prefixo que nao caiu, ou que caiu demais), e ver so um dos dois
    // manda quem depura pro lugar errado.
    const caminhoBruto = resolvido.caminhoBruto || caminho;
    const permitida = origem => origensPermitidas().includes(origem);

    let roteadorAtual;
    try {
      roteadorAtual = await acharRoteador();
    } catch (e) {
      console.error('[api] tabela de rotas indisponivel', e);
      // 503 e nao 404: a plataforma ALCANCOU a funcao, o que falta e a tabela.
      // 404 aqui seria indistinguivel de rewrite errado, e foi um 404 ambiguo
      // que escondeu o dia inteiro de 25/08.
      return escreverCru(res, 503, { ok: false, erro: {
        codigo: 'TABELA_DE_ROTAS_INDISPONIVEL',
        mensagem: 'a ponte esta de pe mas nao carregou a tabela de rotas',
        caminho_recebido: caminho
      } }, cabecalhosDeCors(CORS.ABERTO, req.headers.origin, permitida));
    }

    // Rota desconhecida responde ANTES de montar contexto. Ordem invertida
    // (contexto primeiro) fazia caminho inexistente devolver o erro de
    // CONFIGURACAO em vez de 404 -- ou seja, escondia "essa rota nao existe"
    // atras de "falta env var". Defeito meu, pego pela contraprova do teste
    // local: a rota inventada tinha de dar 404 e estava dando 503.
    const rota = roteadorAtual.achar(caminho);
    if (!rota) {
      return escreverCru(res, 404, { ok: false, erro: {
        codigo: 'ROTA_DESCONHECIDA', mensagem: 'rota desconhecida'
      }, caminho_recebido: caminhoBruto, caminho_procurado: caminho,
         caminhos_conhecidos: roteadorAtual.caminhos() },
      cabecalhosDeCors(CORS.ABERTO, req.headers.origin, permitida));
    }
    // Rota desconhecida nao ganha politica de face: cai na politica padrao.
    const politica = rota && rota.cors === CORS.LISTA_FACE ? CORS.LISTA_FACE : CORS.ABERTO;

    // Preflight antes de qualquer coisa: ele nao carrega credencial e nao deve
    // pagar o custo de montar repositorio.
    if (req.method === 'OPTIONS') {
      return escrever(res, respostaDePreflight(politica, req.headers.origin, permitida), permitida, req, politica);
    }

    const cabecalhosCors = () => cabecalhosDeCors(politica, req.headers.origin, permitida);

    try {
      const nucleo = await obterContexto();
      const { corpo, bruto } = await lerCorpo(req);
      const agoraMs = Date.now();

      const requisicao = {
        caminho,
        metodo: req.method,
        corpo,
        corpoBruto: bruto,
        tamanhoCorpo: Buffer.byteLength(bruto || '', 'utf8'),
        credencial: extrairBearer(req),
        idempotencyKey: req.headers['idempotency-key'],
        origemPedida: req.headers.origin,
        ua: req.headers['user-agent'] || '',
        tokenDaQuery,
        ip: ipDaRequisicao(req),
        agoraMs,
        agoraIso: new Date(agoraMs).toISOString(),
        dispositivo: null,
        rh: null,
        sessaoGestor: null
      };

      const resposta = await despachar(nucleo, roteadorAtual, requisicao);
      return escreverCru(res, resposta.status, resposta.corpo,
        Object.assign(cabecalhosCors(), resposta.cabecalhos || {}));
    } catch (e) {
      const mapeada = mapearErro(e);
      if (mapeada) {
        return escreverCru(res, mapeada.status, mapeada.corpo,
          Object.assign(cabecalhosCors(), mapeada.cabecalhos || {}));
      }
      // Log server-side com o erro inteiro; resposta sem uma palavra dele.
      console.error('[api] falha nao tratada em ' + caminho, e);
      return escreverCru(res, 503, {
        ok: false, erro: { codigo: 'INDISPONIVEL', mensagem: 'servico indisponivel' }
      }, cabecalhosCors());
    }
  };
}

function extrairBearer(req) {
  const valor = String(req.headers.authorization || '');
  return valor.startsWith('Bearer ') ? valor.slice(7) : '';
}

function escrever(res, resposta, permitida, req, politica) {
  return escreverCru(res, resposta.status, resposta.corpo,
    Object.assign(cabecalhosDeCors(politica, req.headers.origin, permitida), resposta.cabecalhos || {}));
}

/** Corpo null vira resposta sem corpo (preflight). */
export function escreverCru(res, status, corpo, cabecalhos) {
  const finais = Object.assign({}, cabecalhos);
  // Resposta de API nunca e cacheavel: marcacao servida de cache mentiria
  // sobre ponto registrado (docs/vercel-na-frente-do-n8n.md).
  finais['Cache-Control'] = finais['Cache-Control'] || 'no-store, must-revalidate';
  res.statusCode = status;
  if (corpo == null) {
    for (const [k, v] of Object.entries(finais)) res.setHeader(k, v);
    res.end();
    return;
  }
  finais['Content-Type'] = finais['Content-Type'] || 'application/json; charset=utf-8';
  for (const [k, v] of Object.entries(finais)) res.setHeader(k, v);
  res.end(JSON.stringify(corpo));
}
