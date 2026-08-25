// A TABELA de rotas do nucleo — liga caminho -> caso de uso -> politica de
// AUTH/CORS. Fonte unica: tanto o servidor de teste (tests/e2e/servidor-falso.js)
// quanto a ponte da Vercel (servidor/api/roteador.js, via servidor/lib/rotas.js)
// importam DAQUI, nunca duplicam a lista — foi divergencia entre o que o teste
// serve e o que a producao expoe que custou o dia 25/08 (nenhuma das 8 rotas
// publicada, e ninguem viu porque cada medicao ficava dentro do proprio pedaco).
//
// Cada entrada e o `@typedef Rota` de nucleo/http.js:57. So as rotas que ja
// migraram pro nucleo entram aqui — as outras 17 continuam no codigo antigo
// de servidor-falso.js ate API-4 portar (nucleo/LEIA-ME.md).

import { AUTH, CORS } from './http.js';
import { enviarLote } from './casos/marcacao.js';
import { obterSal } from './casos/rh.js';
import { obterCarga } from './casos/dispositivo.js';
import { registrar, consultarEstado, aprovar, listar } from './casos/aparelho.js';
import { cadastrar as cadastrarFace } from './casos/face.js';

export const ROTAS = [
  { caminho: '/efrat/marcacoes', metodos: ['POST'], auth: AUTH.TOKEN_OU_APARELHO,
    cors: CORS.ABERTO, manipulador: enviarLote },
  { caminho: '/efrat/rh/sal', metodos: ['POST'], auth: AUTH.ABERTA,
    cors: CORS.ABERTO, manipulador: obterSal },
  { caminho: '/efrat/carga', metodos: ['POST'], auth: AUTH.APARELHO,
    cors: CORS.ABERTO, manipulador: obterCarga },
  { caminho: '/efrat/dispositivo/registrar', metodos: ['POST'], auth: AUTH.ABERTA,
    cors: CORS.ABERTO, manipulador: registrar },
  { caminho: '/efrat/dispositivo/estado', metodos: ['POST'], auth: AUTH.APARELHO,
    cors: CORS.ABERTO, manipulador: consultarEstado },
  { caminho: '/efrat/rh/aparelho/aprovar', metodos: ['POST'], auth: AUTH.RH,
    cors: CORS.ABERTO, manipulador: aprovar },
  { caminho: '/efrat/rh/aparelhos', metodos: ['POST'], auth: AUTH.RH,
    cors: CORS.ABERTO, manipulador: listar },
  { caminho: '/efrat/rh/face/cadastrar', metodos: ['POST'], auth: AUTH.RH,
    cors: CORS.ABERTO, manipulador: cadastrarFace }
];
