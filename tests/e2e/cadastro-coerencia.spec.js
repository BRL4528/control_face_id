// Contrato de /efrat/cadastro — a regra que impede um lote de 3 fotos com duas
// pessoas diferentes de virar template.
//
// Invariantes de docs/fase3-seguranca.md §4 (4.2a, 4.2b, 4.2d e o teste do §4.3).
// Cartão que implementa: T-8ADD9C (Full-Stack Biometria, 6d0c426d7f).
//
// ESTES TESTES NASCEM VERMELHOS, E ISSO É O PONTO. Hoje o servidor aceita
// qualquer lote: /efrat/cadastro exige só `vetores` não-vazio
// (servidor-falso.js:544-546). A única verificação de coerência do produto está
// no navegador, em js/rh.js:504-509, é um `confirm()` (o operador clica OK e
// grava) e usa limiar 0,55 — que fica ENTRE o aceite 0,45 e o par medido de
// pessoas diferentes 0,61. O vermelho aqui é a prova do defeito; o verde é o
// aceite do T-8ADD9C.
//
// Nível de contrato (chamada direta à rota), não de tela, de propósito: a UI de
// cadastro está sendo reescrita em paralelo e a regra não é dela.

import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';
import {
  loteMesmaPessoa, loteDuasPessoas, loteDuasPessoasDistante,
  loteComMaiorDistancia, loteExatamenteNoLimiar, maiorDistanciaParAPar
} from './fixtures-biometria.js';

const CREDENCIAL = 'credencial-de-teste';
const LIMIAR_ACEITE = 0.45;   // js/config.js

let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
  ctx.estado.dispositivos.set('disp-1', {
    dispositivo_id: 'disp-1',
    credencial_hash: crypto.createHash('sha256').update(CREDENCIAL).digest('base64url'),
    estado: 'ativo', codigo_curto: null, apelido: 'Tablet teste', ua: 'teste',
    geo: null, tentativas: 1, local_id: 'local-piloto', equipes_ids: ['eq-1'],
    configuracao_versao: 1
  });
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

async function cadastrar(request, corpo) {
  return request.post(`${ctx.base}/efrat/cadastro`, {
    headers: { Authorization: `Bearer ${CREDENCIAL}`, 'Content-Type': 'application/json' },
    data: Object.assign({
      dispositivo_id: 'disp-1', origem: 'rh',
      nome: 'Novo Colaborador', matricula: 'NOVA-001', equipe_id: 'eq-1',
      miniatura: ''
    }, corpo),
    failOnStatusCode: false
  });
}

/** A pessoa existe no cadastro do servidor? É a prova de "não gravou nada". */
async function pessoaFoiGravada(request, matricula = 'NOVA-001') {
  const r = await request.post(`${ctx.base}/efrat/rh/dados`, {
    data: { usuario: 'rh', chave: 'CHAVE-DE-TESTE', dias: 30 }
  });
  const corpo = await r.json();
  return (corpo.pessoas || []).some(p => p.matricula === matricula);
}

/* ---------------------------------------------------------- §4.3 headline */

test('lote de 3 fotos com duas pessoas diferentes é recusado e não grava template', async ({ request }) => {
  const vetores = loteDuasPessoas();
  // Duas capturas da mesma pessoa (0,094) + uma de outra (0,61). README.md:129.
  expect(maiorDistanciaParAPar(vetores)).toBeGreaterThan(LIMIAR_ACEITE);

  const r = await cadastrar(request, { vetores });

  expect(r.status(), 'lote incoerente tem de ser recusado com 422').toBe(422);
  expect(await pessoaFoiGravada(request), 'nada pode ser gravado numa recusa').toBe(false);
});

test('contraprova — 3 capturas da mesma pessoa gravam normalmente', async ({ request }) => {
  // Sem esta contraprova, o teste acima passaria por o servidor estar recusando tudo.
  const vetores = loteMesmaPessoa();
  expect(maiorDistanciaParAPar(vetores)).toBeLessThan(LIMIAR_ACEITE);

  const r = await cadastrar(request, { vetores });

  expect(r.status()).toBe(200);
  expect(await pessoaFoiGravada(request)).toBe(true);
});

test('o outro par medido de pessoas diferentes (0,80) também é recusado', async ({ request }) => {
  const vetores = loteDuasPessoasDistante();
  expect(maiorDistanciaParAPar(vetores)).toBeGreaterThan(LIMIAR_ACEITE);

  const r = await cadastrar(request, { vetores });

  expect(r.status()).toBe(422);
  expect(await pessoaFoiGravada(request)).toBe(false);
});

/* ------------------------------------------- 4.2a — servidor calcula, não confia */

test('coerência informada pelo cliente não muda o veredito do servidor', async ({ request }) => {
  // Decisão do Orquestrador em T-8ADD9C, divergindo da proposta original do QA:
  // o servidor CALCULA a coerência dos vetores recebidos em vez de conferir o
  // número que o cliente manda. A prova de que o número do cliente não vale
  // está no próprio repo — js/fila.js:262 manda `coerencia: 0` fixo no caminho
  // do gestor, sobre capturas que ninguém verificou.
  const r = await cadastrar(request, { vetores: loteDuasPessoas(), coerencia: 0 });

  expect(r.status(), 'um lote incoerente com coerencia:0 no corpo continua incoerente').toBe(422);
  expect(await pessoaFoiGravada(request)).toBe(false);
});

test('o caminho do gestor cai na mesma regra do caminho do RH', async ({ request }) => {
  // js/fila.js:259-262 envia origem 'gestor' sem nenhuma verificação de
  // coerência no cliente — é o caminho mais desprotegido dos três hoje.
  const r = await cadastrar(request, { origem: 'gestor', vetores: loteDuasPessoas(), coerencia: 0 });

  expect(r.status()).toBe(422);
});

/* --------------------------------------------------- 4.2d — forma do lote */

test('lote precisa ter exatamente três descritores', async ({ request }) => {
  const tres = loteMesmaPessoa();

  expect((await cadastrar(request, { vetores: tres.slice(0, 2) })).status(),
    'dois descritores não formam um lote').toBe(422);
  expect((await cadastrar(request, { vetores: [...tres, tres[0]] })).status(),
    'quatro descritores não formam um lote').toBe(422);
  expect(await pessoaFoiGravada(request)).toBe(false);
});

test('descritor malformado é recusado', async ({ request }) => {
  const tres = loteMesmaPessoa();

  const curto = tres.slice(); curto[2] = curto[2].slice(0, 127);
  expect((await cadastrar(request, { vetores: curto })).status(),
    'descritor com 127 posições').toBe(422);

  const comNaN = tres.map(v => v.slice()); comNaN[1][0] = Number.NaN;
  expect((await cadastrar(request, { vetores: comNaN })).status(),
    'descritor com NaN').toBe(422);

  expect(await pessoaFoiGravada(request)).toBe(false);
});

/* ------------------------------------------------------------ 4.2c — limiar */

test('exatamente no limiar (0,45) o cadastro recusa — assimetria proposital com o reconhecimento', async ({ request }) => {
  // Decisão do Orquestrador: `>= limiarAceite` RECUSA no cadastro, enquanto
  // `vereditoPorDistancia` (js/regras.js:14) ACEITA com `<=` no reconhecimento.
  // A assimetria é intencional e a razão é o raio do erro: no reconhecimento a
  // decisão de fronteira é um evento só, reversível, e cai na mesa do RH se
  // estiver errada; no cadastro o template grava uma vez e vale para sempre, e
  // um lote que nasce na fronteira produz erro em toda marcação futura daquela
  // pessoa — corretamente aceita, sem nada retido para revisar.
  // Exato, não aproximado: `loteComMaiorDistancia(0.45)` daria 0,45011, e o
  // teste passaria por estar ACIMA do limiar em vez de estar NELE.
  const noLimiar = loteExatamenteNoLimiar(LIMIAR_ACEITE);
  expect(maiorDistanciaParAPar(noLimiar)).toBe(LIMIAR_ACEITE);

  const r = await cadastrar(request, { vetores: noLimiar });

  expect(r.status(), 'no limiar exato o cadastro recusa, ao contrário do reconhecimento').toBe(422);
  expect(await pessoaFoiGravada(request)).toBe(false);
});

test('o veredito vira em torno do limiar de aceite, não de 0,55', async ({ request }) => {
  // O limiar do produto é 0,45 (js/config.js). O 0,55 de js/rh.js:508 deixa
  // passar calada toda a faixa 0,45–0,55 — este teste é o que trava isso.
  //
  // O comportamento em EXATAMENTE 0,45 está no teste seguinte — era ambíguo
  // quando escrevi este arquivo e virou decisão do Orquestrador desde então.
  const abaixo = loteComMaiorDistancia(0.44);
  const acima = loteComMaiorDistancia(0.46);

  expect((await cadastrar(request, { vetores: acima })).status(),
    '0,46 está acima do aceite e tem de recusar').toBe(422);
  expect(await pessoaFoiGravada(request)).toBe(false);

  expect((await cadastrar(request, { vetores: abaixo })).status(),
    '0,44 está abaixo do aceite e tem de gravar').toBe(200);
  expect(await pessoaFoiGravada(request)).toBe(true);
});
