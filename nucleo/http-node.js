// (c) O ADAPTADOR HTTP — parte de baixo, a ponte com node:http.
//
// E a UNICA peca do nucleo que sabe o que e um `req`/`res` do Node. Tudo o que
// esta acima dela (nucleo/http.js, nucleo/casos/*) trabalha com dado simples.
// Trocar para Request/Response da Vercel e escrever um irmao deste arquivo —
// nao e mexer em regra nenhuma.
//
// Nao ha `node:http` importado aqui de proposito: a ponte so LE os objetos que
// recebe. Assim ela tambem serve para qualquer coisa com a mesma forma.

/** Le corpo cru + cabecalhos e monta a `Requisicao` de nucleo/contexto.js. */
export async function lerRequisicao(req, { caminho, tokenDaQuery, agoraMs, ip }) {
  let bruto = '';
  for await (const pedaco of req) bruto += pedaco;
  let corpo = {};
  try { corpo = bruto ? JSON.parse(bruto) : {}; } catch (e) { /* corpo vazio */ }

  const autorizacao = String(req.headers.authorization || '');
  const agora = agoraMs == null ? Date.now() : agoraMs;

  return {
    caminho,
    metodo: req.method,
    corpo,
    corpoBruto: bruto,
    tamanhoCorpo: bruto.length,
    credencial: autorizacao.startsWith('Bearer ') ? autorizacao.slice(7) : '',
    idempotencyKey: req.headers['idempotency-key'],
    origemPedida: req.headers.origin,
    ua: req.headers['user-agent'] || '',
    tokenDaQuery: tokenDaQuery || '',
    ip: ip || (req.socket && req.socket.remoteAddress) || 'desconhecido',
    agoraMs: agora,
    agoraIso: new Date(agora).toISOString(),
    dispositivo: null,
    rh: null,
    sessaoGestor: null
  };
}

/** Escreve `{status, corpo, cabecalhos}` no `res`. Corpo null vira sem corpo. */
export function escreverResposta(res, resposta, cabecalhosBase) {
  const cabecalhos = Object.assign({}, cabecalhosBase, resposta.cabecalhos || {});
  if (resposta.corpo == null) {
    res.writeHead(resposta.status, cabecalhos);
    res.end();
    return;
  }
  cabecalhos['Content-Type'] = cabecalhos['Content-Type'] || 'application/json';
  res.writeHead(resposta.status, cabecalhos);
  res.end(JSON.stringify(resposta.corpo));
}
