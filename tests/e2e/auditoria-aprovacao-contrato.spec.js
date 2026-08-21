// Rastro auditável de POST /efrat/rh/aparelho/aprovar — docs/fase3-seguranca.md
// §2.1e, docs/adr-acesso-v3.md (formato de efrat_auditoria_identificacao).
// Cartão: T-81C721.
//
// Lacuna que este arquivo fecha, declarada ao fechar o T-C20AD3: hoje o 429
// (LIMITE_APROVACAO) acontece e não sobra rastro de nada — quem tentou,
// quantas vezes, contra qual pendente, de onde. Registrar só quando o
// limite estoura é detector que só acende no caso barulhento: dez códigos
// errados por dia, todo dia, nunca batendo o teto, é o padrão mais parecido
// com alguém tentando de verdade, e ficava invisível.
//
// O que estes testes precisam provar não é "o registro existe" — é que uma
// SEQUÊNCIA de tentativas produz um rastro LEGÍVEL, na ordem certa, com
// tentativa CORRETA aparecendo também. Sem isso o log só tem falha, e
// ninguém consegue distinguir "RH desastrado" de "alguém tentando", que é a
// pergunta que o log existe para responder. E o código tentado nunca pode
// aparecer — não serve para investigar, só vira lista de códigos pra quem
// ler o log.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';

const RH = { usuario: 'rh', chave: 'CHAVE-DE-TESTE' };
let ctx;

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});
test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

async function registrar(request, apelido = 'Tablet Obra Norte') {
  const r = await request.post(`${ctx.base}/efrat/dispositivo/registrar`, {
    data: {
      dispositivo_id: crypto.randomUUID(),
      credencial_publica: crypto.createHash('sha256').update(crypto.randomUUID()).digest('base64url'),
      apelido, ua: 'teste'
    }
  });
  return await r.json();
}

async function aprovar(request, dados) {
  const r = await request.post(`${ctx.base}/efrat/rh/aparelho/aprovar`, {
    data: Object.assign({ idempotency_key: crypto.randomUUID() }, RH, dados)
  });
  return { status: r.status(), json: await r.json() };
}

test('uma sequência de tentativas erradas seguida da correta produz um rastro legível, na ordem, com a correta aparecendo também', async ({ request }) => {
  const a = await registrar(request);

  await aprovar(request, { codigo: 'ZZZZZZ' });                      // não resolve
  await aprovar(request, { codigo: 'AB0L1O' });                      // letra fora do alfabeto
  await aprovar(request, { codigo: a.codigo_curto, equipes_ids: [] }); // certo, mas escopo vazio
  const feliz = await aprovar(request, { codigo: a.codigo_curto, equipes_ids: ['eq-1'] }); // certo
  expect(feliz.status).toBe(200);

  const rastro = ctx.estado.auditoriaAprovacao;
  expect(rastro.map(r => r.resultado)).toEqual([
    'codigo_nao_encontrado', 'letra_invalida', 'escopo_vazio', 'aprovado'
  ]);

  // a tentativa correta aparece no rastro — não é só um log de falhas.
  expect(rastro.at(-1).resultado).toBe('aprovado');

  // as duas primeiras nunca chegaram a resolver um pendente; a terceira e a
  // quarta resolveram o MESMO pendente (código certo nas duas).
  expect(rastro[0].pendente_id).toBeNull();
  expect(rastro[1].pendente_id).toBeNull();
  expect(rastro[2].pendente_id).toBe(rastro[3].pendente_id);
  expect(rastro[3].pendente_id).toBeTruthy();

  // quem, quando: usuario_rh e instante em toda linha; nada de código
  // tentado em lugar nenhum do rastro.
  for (const linha of rastro) {
    expect(linha.usuario_rh).toBe('rh');
    expect(linha.instante).toBeTruthy();
    expect(linha.request_id).toBeTruthy();
  }
  expect(JSON.stringify(rastro)).not.toContain('ZZZZZZ');
  expect(JSON.stringify(rastro)).not.toContain(a.codigo_curto);
});

test('tentativa paciente — várias erradas espalhadas, nenhuma batendo o limite — ainda deixa rastro, não só o 429', async ({ request }) => {
  await registrar(request);

  for (let i = 0; i < 5; i++) await aprovar(request, { codigo: 'ZZZZZZ' });

  const rastro = ctx.estado.auditoriaAprovacao;
  expect(rastro).toHaveLength(5);
  expect(rastro.every(r => r.resultado === 'codigo_nao_encontrado')).toBe(true);
  // nenhuma bateu 429 — o padrão paciente não é detectado por limite, mas
  // continua rastreável porque cada tentativa, sozinha, já virou linha.
  expect(rastro.some(r => r.resultado === 'limitado')).toBe(false);
});

test('estourar o limite entra no rastro como o próprio evento "limitado", não só como recusa silenciosa', async ({ request }) => {
  await registrar(request);

  let ultimoStatus = null;
  for (let i = 0; i < 12; i++) {
    ultimoStatus = (await aprovar(request, { codigo: 'ZZZZZZ' })).status;
  }
  expect(ultimoStatus).toBe(429);

  const rastro = ctx.estado.auditoriaAprovacao;
  expect(rastro.some(r => r.resultado === 'limitado')).toBe(true);
});
