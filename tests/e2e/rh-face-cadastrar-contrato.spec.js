// Contrato de POST /efrat/rh/face/cadastrar (docs/fase3-contrato.md § 4.3 +
// § 4.7). Rota nova para os caminhos 2 (câmera do PC) e 3 (upload) de cadastro
// de face — a antiga /efrat/cadastro (tests/e2e/cadastro-coerencia.spec.js)
// continua existindo só para o aparelho em campo (origem: "gestor").
//
// Autenticada como RH (usuario + chave no corpo, como as demais rotas
// /efrat/rh/*), não como aparelho — corrige o defeito de js/rh.js:512 usar a
// credencial emprestada de um dispositivo que pode nem existir.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';
import { loteMesmaPessoa, loteDuasPessoas, maiorDistanciaParAPar } from './fixtures-biometria.js';

const USUARIO = 'rh';
const CHAVE = 'CHAVE-DE-TESTE';
const MODELO_ID_A = 'a'.repeat(64);
const MODELO_ID_B = 'b'.repeat(64);

let ctx;

test.beforeEach(async () => {
  const { servidor, estado, pessoas } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, pessoas, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});

test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

let contadorChave = 0;
function chaveNova() { return 'idem-' + (++contadorChave); }

async function cadastrar(request, corpo, idempotencyKey) {
  return request.post(`${ctx.base}/efrat/rh/face/cadastrar`, {
    data: Object.assign({
      usuario: USUARIO, chave: CHAVE, idempotency_key: idempotencyKey || chaveNova(),
      pessoa_id: 'p-ana', origem: 'rh_camera', miniatura: '', modelo_id: MODELO_ID_A
    }, corpo),
    failOnStatusCode: false
  });
}

test('modelo_id ausente é recusado com 400 MODELO_AUSENTE — rota nova não tolera, ao contrário da antiga', async ({ request }) => {
  const r = await cadastrar(request, { vetores: loteMesmaPessoa(), modelo_id: undefined });
  expect(r.status()).toBe(400);
  const corpo = await r.json();
  expect(corpo.erro.codigo).toBe('MODELO_AUSENTE');
  expect(ctx.pessoas.find(p => p.pessoa_id === 'p-ana').versao).toBe(1); // seed inicial, nada gravado
});

test('pessoa_id inexistente é recusado com 404 — a rota nunca cria pessoa, só anexa biometria', async ({ request }) => {
  const r = await cadastrar(request, { pessoa_id: 'p-fantasma', vetores: loteMesmaPessoa() });
  expect(r.status()).toBe(404);
});

test('lote incoerente é recusado e não sobrescreve nada', async ({ request }) => {
  const antes = Object.assign({}, ctx.pessoas.find(p => p.pessoa_id === 'p-ana'));
  const r = await cadastrar(request, { vetores: loteDuasPessoas() });
  expect(r.status()).toBe(422);
  const depois = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  expect(depois.versao).toBe(antes.versao);
  expect(depois.vetores).toEqual(antes.vetores);
});

test('origem rh_camera grava direto (ativo) — captura ao vivo, RH está vendo a pessoa', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const r = await cadastrar(request, { origem: 'rh_camera', vetores });
  expect(r.status()).toBe(200);
  const corpo = await r.json();
  expect(corpo.estado).toBe('ativo');
  expect(corpo.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);
  expect(corpo.versao).toBe(2); // p-ana já nasce com versao:1 no fixture padrão

  const pessoa = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  expect(pessoa.vetores).toEqual(vetores);
  expect(pessoa.versao).toBe(2);
  expect(pessoa.origem).toBe('rh_camera');
});

test('origem rh_upload vai para a fila pendente — nunca sobrescreve o template vigente (§ 1.3a)', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const vetoresOriginais = ctx.pessoas.find(p => p.pessoa_id === 'p-ana').vetores;
  const r = await cadastrar(request, { origem: 'rh_upload', vetores });
  expect(r.status()).toBe(200);
  const corpo = await r.json();
  expect(corpo.estado).toBe('pendente');

  const pessoa = ctx.pessoas.find(p => p.pessoa_id === 'p-ana');
  expect(pessoa.vetores).toEqual(vetoresOriginais); // template vigente intacto

  const pendencia = ctx.estado.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia).toBeTruthy();
  expect(pendencia.origem).toBe('rh_upload');
  expect(pendencia.vetores).toEqual(vetores);
});

test('modelo_id nunca visto antes é modelo_desconhecido — não há referência ainda pra comparar', async ({ request }) => {
  const r = await cadastrar(request, { vetores: loteMesmaPessoa(), modelo_id: MODELO_ID_A });
  const corpo = await r.json();
  expect(corpo.modelo_desconhecido).toBe(true);
  expect(corpo.modelo_divergente).toBe(false);
});

test('modelo_id igual à referência do app grava limpo — nem divergente, nem desconhecido', async ({ request }) => {
  // Estabelece a referência via /efrat/carga, o único jeito que §4.7 permite.
  ctx.estado.dispositivos.set('disp-ref', {
    dispositivo_id: 'disp-ref', credencial_hash: crypto.createHash('sha256').update('cred-ref').digest('base64url'),
    estado: 'ativo', equipes_ids: ['eq-1'], configuracao_versao: 1
  });
  await request.post(`${ctx.base}/efrat/carga`, {
    headers: { Authorization: 'Bearer cred-ref' },
    data: { dispositivo_id: 'disp-ref', modelo_id: MODELO_ID_A }
  });

  const r = await cadastrar(request, { vetores: loteMesmaPessoa(), modelo_id: MODELO_ID_A });
  const corpo = await r.json();
  expect(corpo.modelo_desconhecido).toBe(false);
  expect(corpo.modelo_divergente).toBe(false);
});

test('modelo_id conhecido mas diferente da referência grava e marca modelo_divergente — nunca recusa', async ({ request }) => {
  ctx.estado.dispositivos.set('disp-ref', {
    dispositivo_id: 'disp-ref', credencial_hash: crypto.createHash('sha256').update('cred-ref').digest('base64url'),
    estado: 'ativo', equipes_ids: ['eq-1'], configuracao_versao: 1
  });
  // Referência atual é B (o app reportou B por último).
  await request.post(`${ctx.base}/efrat/carga`, {
    headers: { Authorization: 'Bearer cred-ref' },
    data: { dispositivo_id: 'disp-ref', modelo_id: MODELO_ID_B }
  });
  // A já foi visto uma vez antes (por outro cadastro), então é "conhecido".
  await cadastrar(request, { pessoa_id: 'p-bruno', vetores: loteMesmaPessoa(), modelo_id: MODELO_ID_A });

  const r = await cadastrar(request, { pessoa_id: 'p-carla', vetores: loteMesmaPessoa(), modelo_id: MODELO_ID_A });
  expect(r.status()).toBe(200); // nunca recusa por divergência de modelo
  const corpo = await r.json();
  expect(corpo.modelo_divergente).toBe(true);
  expect(corpo.modelo_desconhecido).toBe(false);
});

test('idempotência: mesma chave e mesmo corpo repete a resposta, sem gravar duas vezes', async ({ request }) => {
  const chave = chaveNova();
  const vetores = loteMesmaPessoa();
  const r1 = await cadastrar(request, { vetores }, chave);
  const r2 = await cadastrar(request, { vetores }, chave);
  expect(await r1.json()).toEqual(await r2.json());
  expect(ctx.pessoas.find(p => p.pessoa_id === 'p-ana').versao).toBe(2); // só uma vez, não duas
});

test('idempotência: mesma chave com corpo diferente é 409 IDEMPOTENCIA_CONFLITANTE', async ({ request }) => {
  const chave = chaveNova();
  await cadastrar(request, { vetores: loteMesmaPessoa() }, chave);
  const r2 = await cadastrar(request, { vetores: loteMesmaPessoa(), pessoa_id: 'p-bruno' }, chave);
  expect(r2.status()).toBe(409);
  const corpo = await r2.json();
  expect(corpo.erro.codigo).toBe('IDEMPOTENCIA_CONFLITANTE');
});

test('idempotency_key ausente é 400 IDEMPOTENCIA_AUSENTE — obrigatória nas rotas novas (C2)', async ({ request }) => {
  const r = await cadastrar(request, { vetores: loteMesmaPessoa(), idempotency_key: undefined });
  expect(r.status()).toBe(400);
  const corpo = await r.json();
  expect(corpo.erro.codigo).toBe('IDEMPOTENCIA_AUSENTE');
});
