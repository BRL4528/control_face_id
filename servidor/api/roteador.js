// Ponte entre a Vercel e o roteador do nucleo.
//
// ESTE ARQUIVO E O IRMAO DE nucleo/http-node.js, e nao muda REGRA NENHUMA. Todo
// o comportamento — autenticacao, CORS, idempotencia, despacho — vive em
// nucleo/http.js. Aqui so se traduz o formato de requisicao da Vercel para o
// que o nucleo espera, e a resposta de volta.
//
// COMO O CAMINHO CHEGA: o vercel.json reescreve /efrat/* e /webhook/efrat/*
// para ca, passando o caminho original em query (`base` + `caminho`). Nao se
// deduz o caminho de req.url: sob rewrite, o que req.url carrega e detalhe de
// plataforma, e o contrato do nucleo diz que rota casa por comparacao EXATA —
// "/rh/aparelho/aprovar" e "/rh/aparelho" nao podem virar a mesma coisa por
// causa de um prefixo mal remontado.
//
// ESTADO: PONTE MONTADA, ROTAS AINDA NAO REGISTRADAS.
// O nucleo tem criarRoteador/despachar e os casos de uso, mas ainda nao existe
// a TABELA que liga caminho -> manipulador (cartao API-4). Enquanto ela nao
// existir, esta funcao responde 501 com a lista do que falta — e NAO 404.
//
// A diferenca importa e foi cara hoje: 404 diz "nao existe" e e indistinguivel
// de deploy errado, de rewrite errado ou de origem errada. 501 diz "a
// plataforma te alcancou, o codigo e que nao esta aqui". Foi um 404 ambiguo que
// escondeu o dia inteiro que o n8n nunca saiu do v2.

import { carregarRotas } from '../lib/rotas.js';

export default async function handler(req, res) {
  const base = (req.query && req.query.base) || '';
  const resto = (req.query && req.query.caminho) || '';
  const caminho = base + (resto ? '/' + resto : '');

  const { roteador, erro } = await carregarRotas();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!roteador) {
    res.statusCode = 501;
    res.end(JSON.stringify({
      ok: false,
      erro: 'NAO_IMPLEMENTADO',
      detalhe: 'a ponte da Vercel esta montada e alcancou esta funcao, mas a ' +
               'tabela de rotas do nucleo ainda nao existe (cartao API-4)',
      caminho_recebido: caminho,
      causa: erro
    }));
    return;
  }

  const rota = roteador.achar(caminho);
  if (!rota) {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, erro: 'ROTA_DESCONHECIDA', caminho_recebido: caminho }));
    return;
  }

  res.statusCode = 501;
  res.end(JSON.stringify({
    ok: false,
    erro: 'NAO_IMPLEMENTADO',
    detalhe: 'rota registrada, falta o despacho desta ponte (cartao API-4)',
    caminho_recebido: caminho
  }));
}
