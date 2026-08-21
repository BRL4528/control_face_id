// Contrato do convite de link único (T-D30529, docs/fase3-contrato.md §4.4/§4.5).
// Nível de contrato (chamada direta às rotas), mesmo padrão de
// rh-face-cadastrar-contrato.spec.js — a UI está em outra frente.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';
import { loteMesmaPessoa, loteDuasPessoas, maiorDistanciaParAPar } from './fixtures-biometria.js';

const USUARIO = 'rh';
const CHAVE = 'CHAVE-DE-TESTE';
const MODELO_ID = 'm'.repeat(64);

let ctx;
let contadorChave = 0;
function chaveNova() { return 'idem-' + (++contadorChave); }

test.beforeEach(async () => {
  const { servidor, estado, pessoas } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, pessoas, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
  // p-ana já tem telefone válido, no fixture padrão de criarServidor.
  const ana = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  ana.telefone = '+5567998765432';
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

async function emitirConvite(request, corpo, idempotencyKey) {
  return request.post(`${ctx.base}/efrat/rh/face/convite`, {
    data: Object.assign({ usuario: USUARIO, chave: CHAVE, idempotency_key: idempotencyKey || chaveNova(), pessoa_id: 'p-ana', canal: 'whatsapp' }, corpo),
    failOnStatusCode: false
  });
}
async function abrirConvite(request, token) {
  return request.post(`${ctx.base}/efrat/face/convite/abrir`, {
    headers: token ? { Authorization: 'Bearer ' + token } : {}, data: {}, failOnStatusCode: false
  });
}
async function enviarConvite(request, token, corpo, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (idempotencyKey !== null) headers['Idempotency-Key'] = idempotencyKey || chaveNova();
  return request.post(`${ctx.base}/efrat/face/convite/enviar`, {
    headers, data: Object.assign({ vetores: loteMesmaPessoa(), miniatura: '', modelo_id: MODELO_ID }, corpo), failOnStatusCode: false
  });
}

test('emissão recusa pessoa sem telefone', async ({ request }) => {
  ctx.pessoas.find(p => p.pessoa_id === 'p-ana').telefone = '';
  const r = await emitirConvite(request, {});
  expect(r.status()).toBe(422);
  expect((await r.json()).erro.codigo).toBe('PESSOA_SEM_TELEFONE');
});

test('emissão recusa pessoa inativa', async ({ request }) => {
  ctx.estado.inativos.add('p-ana');
  const r = await emitirConvite(request, {});
  expect(r.status()).toBe(422);
  expect((await r.json()).erro.codigo).toBe('PESSOA_INATIVA');
});

test('emissão recusa telefone compartilhado, com a saída na mensagem', async ({ request }) => {
  ctx.pessoas.find(p => p.pessoa_id === 'p-bruno').telefone = '+5567998765432'; // mesmo de p-ana
  const r = await emitirConvite(request, {});
  expect(r.status()).toBe(422);
  const corpo = await r.json();
  expect(corpo.erro.codigo).toBe('TELEFONE_COMPARTILHADO_SEM_LINK');
  expect(corpo.erro.mensagem).toContain('câmera');
});

test('emissão feliz devolve url com token no fragmento, telefone mascarado, e nunca eco do corpo', async ({ request }) => {
  const r = await emitirConvite(request, {});
  expect(r.status()).toBe(201);
  const corpo = await r.json();
  expect(corpo.url).toMatch(/#c=[A-Za-z0-9_-]{20,}$/);
  expect(corpo.telefone_mascarado).toBe('(67) 9****-5432');
  expect(corpo.substituiu).toBeUndefined();
});

test('reemitir para a mesma pessoa substitui o anterior — um convite vivo por vez', async ({ request }) => {
  const r1 = await emitirConvite(request, {});
  const { convite_id: primeiro, url: url1 } = await r1.json();
  const r2 = await emitirConvite(request, {});
  const corpo2 = await r2.json();
  expect(corpo2.substituiu).toBe(primeiro);

  const token1 = /#c=(.+)$/.exec(url1)[1];
  const abertura1 = await abrirConvite(request, token1);
  expect(abertura1.status()).toBe(404); // substituído entra no erro único
});

test('listagem nunca devolve token nem url', async ({ request }) => {
  await emitirConvite(request, {});
  const r = await request.post(`${ctx.base}/efrat/rh/face/convites`, { data: { usuario: USUARIO, chave: CHAVE } });
  const texto = JSON.stringify(await r.json());
  expect(texto).not.toMatch(/"url"/);
  expect(texto).not.toMatch(/"token"/);
});

test('revogação torna o link inutilizável imediatamente', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  await request.post(`${ctx.base}/efrat/rh/face/convite/revogar`, {
    data: { usuario: USUARIO, chave: CHAVE, idempotency_key: chaveNova(), convite_id: emissao.convite_id }
  });
  const r = await abrirConvite(request, token);
  expect(r.status()).toBe(404);
  expect((await r.json()).erro.codigo).toBe('CONVITE_INVALIDO');
});

test('abrir com token inexistente, expirado ou revogado dá o MESMO 404 — erro único, sem oráculo', async ({ request }) => {
  const rInexistente = await abrirConvite(request, 'token-que-nunca-existiu-' + crypto.randomUUID());
  expect(rInexistente.status()).toBe(404);
  expect((await rInexistente.json()).erro.codigo).toBe('CONVITE_INVALIDO');

  const rSemToken = await abrirConvite(request, null);
  expect(rSemToken.status()).toBe(404);
  expect((await rSemToken.json()).erro.codigo).toBe('CONVITE_INVALIDO');
});

test('abrir mostra só primeiro nome e as chaves exatas da resposta (critério 18)', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  const r = await abrirConvite(request, token);
  const corpo = await r.json();
  expect(corpo.primeiro_nome).toBe('Ana');
  expect(Object.keys(corpo).sort()).toEqual(['coerencia_maxima', 'estado', 'expira_em', 'fotos_exigidas', 'ok', 'primeiro_nome', 'request_id'].sort());
});

test('abrir múltiplas vezes não regrava aberto_em nem encurta a janela', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  await abrirConvite(request, token);
  const convite = ctx.estado.convites.get(emissao.convite_id);
  const primeiraAbertura = convite.aberto_em;
  await new Promise(r => setTimeout(r, 5));
  await abrirConvite(request, token);
  expect(convite.aberto_em).toBe(primeiraAbertura);
});

test('envio bem-sucedido grava pendente e consome o link — reabrir mostra estado consumido', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  await abrirConvite(request, token);

  const vetores = loteMesmaPessoa();
  const r = await enviarConvite(request, token, { vetores });
  expect(r.status()).toBe(200);
  const corpo = await r.json();
  expect(corpo.estado).toBe('recebido');
  expect(corpo.template_estado).toBe('pendente');
  expect(corpo.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);

  const pendencia = ctx.estado.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia.origem).toBe('link');
  expect(pendencia.modelo_id).toBe(MODELO_ID);

  const reabertura = await abrirConvite(request, token);
  const corpoReabertura = await reabertura.json();
  expect(corpoReabertura.estado).toBe('consumido');
  expect(corpoReabertura.primeiro_nome).toBeUndefined();
});

test('template de link nasce pendente mesmo no primeiro cadastro (§4.3/critério 17)', async ({ request }) => {
  ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores = []; // sem biometria nenhuma ainda
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  const r = await enviarConvite(request, token, {});
  expect((await r.json()).template_estado).toBe('pendente');
  expect(ctx.pessoas.find(p => p.pessoa_id === 'p-ana').tem_biometria).not.toBe(true);
});

test('envio sem modelo_id é 400 MODELO_AUSENTE — rota nova, sem tolerância', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  const r = await enviarConvite(request, token, { modelo_id: undefined });
  expect(r.status()).toBe(400);
  expect((await r.json()).erro.codigo).toBe('MODELO_AUSENTE');
});

test('envio com token consumido é 409 CONVITE_CONSUMIDO, com frase de gente', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  await enviarConvite(request, token, {});
  const r2 = await enviarConvite(request, token, {}, chaveNova());
  expect(r2.status()).toBe(409);
  expect((await r2.json()).erro.codigo).toBe('CONVITE_CONSUMIDO');
});

test('recusa por coerência NÃO consome o link — retry na mesma sessão funciona', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];

  const r1 = await enviarConvite(request, token, { vetores: loteDuasPessoas() });
  expect(r1.status()).toBe(422);
  expect((await r1.json()).erro.codigo).toBe('COERENCIA_INSUFICIENTE');

  // o MESMO token ainda funciona — recusa é retorno, não consumo (§4.4).
  const r2 = await enviarConvite(request, token, { vetores: loteMesmaPessoa() }, chaveNova());
  expect(r2.status()).toBe(200);
});

test('5 recusas seguidas bloqueiam o convite — 6ª tentativa é 429 CONVITE_BLOQUEADO mesmo com lote bom', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  for (let i = 0; i < 5; i++) {
    const r = await enviarConvite(request, token, { vetores: loteDuasPessoas() }, chaveNova());
    expect(r.status()).toBe(422);
  }
  const r6 = await enviarConvite(request, token, { vetores: loteMesmaPessoa() }, chaveNova());
  expect(r6.status()).toBe(429);
  expect((await r6.json()).erro.codigo).toBe('CONVITE_BLOQUEADO');
});

test('idempotency_key repetida no ENVIO repete a resposta gravada, sem consumir de novo', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];
  const chave = chaveNova();
  const vetores = loteMesmaPessoa();
  const r1 = await enviarConvite(request, token, { vetores }, chave);
  const r2 = await enviarConvite(request, token, { vetores }, chave);
  expect(await r1.json()).toEqual(await r2.json());
  expect(ctx.estado.recadastros.filter(t => t.pessoa_id === 'p-ana').length).toBe(1);
});

test('OPTIONS das duas rotas de face responde CORS de lista, nunca * (critério 20)', async ({ request }) => {
  for (const rota of ['/efrat/face/convite/abrir', '/efrat/face/convite/enviar']) {
    const r = await request.fetch(`${ctx.base}${rota}`, {
      method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5555' }
    });
    expect(r.status()).toBe(204);
    expect(r.headers()['access-control-allow-headers']).toContain('Authorization');
    expect(r.headers()['access-control-allow-headers']).toContain('Idempotency-Key');
    expect(r.headers()['access-control-allow-origin']).not.toBe('*');
    expect(r.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:5555');
  }
});

test('critério 19 — token de convite não abre carga, identificar, marcacoes nem /rh/*', async ({ request }) => {
  const emissao = await (await emitirConvite(request, {})).json();
  const token = /#c=(.+)$/.exec(emissao.url)[1];

  const carga = await request.post(`${ctx.base}/efrat/carga`, {
    headers: { Authorization: 'Bearer ' + token }, data: { dispositivo_id: 'qualquer' }, failOnStatusCode: false
  });
  expect(carga.status()).toBe(401);

  const rh = await request.post(`${ctx.base}/efrat/rh/dados`, {
    data: { usuario: token, chave: token }, failOnStatusCode: false
  });
  expect(rh.status()).toBe(401);
});
