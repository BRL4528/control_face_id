// PONTE ENTRE A VERCEL E O ROTEADOR DO NUCLEO.
//
// >>> ESTE CORPO E PLACEHOLDER DO DEVOPS. O ARQUIVO E DO ARQUITETO (API-4).
// >>> SUBSTITUA O CORPO INTEIRO. MANTENHA O NOME `roteador.js`.
//
// >>> NAO RENOMEIE PARA [...rota].js. Eu tentei e MEDI: neste projeto a Vercel
// >>> NAO reconhece o catch-all com colchetes como funcao. Os dois nomes foram
// >>> publicados lado a lado no mesmo deploy:
// >>>     /api/roteador     -> 200, corpo JSON da ponte
// >>>     /api/efrat/carga  -> NOT_FOUND
// >>> Colchetes e sintaxe de framework (Next.js); este projeto e funcoes
// >>> zero-config, onde ela nao vale. O 404 seria silencioso: o arquivo existe,
// >>> o deploy fica verde, e so a requisicao real revela.
//
// Ele existe agora para que a PLATAFORMA esteja provada antes do codigo chegar:
// os rewrites, a copia de build do nucleo e a contagem de rotas da saude ja
// foram medidos contra este arquivo em preview.
//
// COMO O CAMINHO CHEGA — e nao e por req.url:
//   vercel.json reescreve  /efrat/*          -> /api/roteador?base=/efrat&caminho=*
//                          /webhook/efrat/*  -> /api/roteador?base=/webhook/efrat&caminho=*
//   entao o caminho original vem em req.query.base + req.query.caminho.
// Sob rewrite, req.url e detalhe de plataforma. O nucleo casa rota por
// comparacao EXATA (nucleo/http.js:57) — "/rh/aparelho/aprovar" e
// "/rh/aparelho" nao podem virar a mesma coisa por um prefixo mal remontado.
//
// POR QUE 501 E NAO 404 enquanto falta a tabela: 404 diz "nao existe" e e
// indistinguivel de deploy errado, rewrite errado ou origem errada. Foi um 404
// ambiguo que escondeu o dia inteiro que o n8n nunca saiu do v2, e outro que
// escondeu de cinco pessoas que nada estava publicado. 501 diz "a plataforma te
// alcancou; o codigo e que nao esta aqui".

import { carregarRotas } from '../lib/rotas.js';

export function caminhoDaRequisicao(req) {
  const base = (req.query && req.query.base) || '';
  const resto = (req.query && req.query.caminho) || '';
  return base + (resto ? '/' + resto : '');
}

export default async function handler(req, res) {
  const caminho = caminhoDaRequisicao(req);
  const { roteador, erro } = await carregarRotas();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!roteador) {
    res.statusCode = 501;
    res.end(JSON.stringify({
      ok: false, erro: 'NAO_IMPLEMENTADO',
      detalhe: 'a ponte da Vercel esta montada e alcancou esta funcao, mas a ' +
               'tabela de rotas do nucleo ainda nao existe (nucleo/rotas.js)',
      caminho_recebido: caminho, causa: erro
    }));
    return;
  }

  if (!roteador.achar(caminho)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, erro: 'ROTA_DESCONHECIDA', caminho_recebido: caminho }));
    return;
  }

  // >>> AQUI ENTRA O DESPACHO (autenticar + despachar de nucleo/http.js,
  // >>> com lerRequisicao/escreverResposta traduzidos para o req/res da Vercel).
  res.statusCode = 501;
  res.end(JSON.stringify({
    ok: false, erro: 'NAO_IMPLEMENTADO',
    detalhe: 'rota registrada; falta o despacho nesta ponte',
    caminho_recebido: caminho
  }));
}
