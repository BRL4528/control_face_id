import { test, expect } from '@playwright/test';
import { criarServidor } from './servidor-falso.js';

let ctx;
test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});
test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

function sessao(token = 'sessao-valida', overrides = {}) {
  const agora = Date.now();
  ctx.estado.sessoesGestor.set(token, {
    gestor_id: 'p-gestor', dispositivo_id: 'disp-1', equipes_ids: ['eq-1'],
    criado_em: agora, ultima_atividade: agora, expira_absoluto: agora + 10 * 60_000,
    evento: 'evento-face-1', ...overrides
  });
  return token;
}

async function ajustar(request, { token = 'sessao-valida', chave = 'idem-1', body = {} } = {}) {
  return request.post(`${ctx.base}/efrat/gestor/ajustar`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': chave },
    data: {
      pessoa_id: 'p-ana', data_local: '2026-08-19', acao: 'incluir_marcacao',
      marcacao: { tipo: 'entrada', em: '2026-08-19T11:00:00Z' },
      motivo: 'Falha de sincronizacao informada', ...body
    }
  });
}

test('contrato gestor/ajustar: sessão expirada devolve 401', async ({ request }) => {
  sessao('expirada', { expira_absoluto: Date.now() - 1 });
  const resposta = await ajustar(request, { token: 'expirada' });
  expect(resposta.status()).toBe(401);
  expect((await resposta.json()).erro.codigo).toBe('SESSAO_EXPIRADA');
});

test('contrato gestor/ajustar: chave repetida com outro corpo devolve 409', async ({ request }) => {
  sessao();
  expect((await ajustar(request)).status()).toBe(202);
  const resposta = await ajustar(request, { body: { motivo: 'Outro motivo suficientemente longo' } });
  expect(resposta.status()).toBe(409);
  expect((await resposta.json()).erro.codigo).toBe('IDEMPOTENCIA_CONFLITANTE');
});

test('contrato gestor/ajustar: motivo com nove caracteres devolve 422', async ({ request }) => {
  sessao();
  const resposta = await ajustar(request, { body: { motivo: '123456789' } });
  expect(resposta.status()).toBe(422);
  expect((await resposta.json()).erro.codigo).toBe('AJUSTE_INVALIDO');
});

test('contrato gestor/ajustar: pessoa fora do escopo devolve 403', async ({ request }) => {
  sessao();
  const resposta = await ajustar(request, { body: { pessoa_id: 'p-carla' } });
  expect(resposta.status()).toBe(403);
  expect((await resposta.json()).erro.codigo).toBe('PESSOA_FORA_DO_ESCOPO');
});

test('contrato gestor/ajustar: feliz cria somente pendência do RH e devolve 202', async ({ request }) => {
  sessao();
  const resposta = await ajustar(request);
  expect(resposta.status()).toBe(202);
  const json = await resposta.json();
  expect(json).toMatchObject({ ok: true, estado: 'pendente_rh' });
  expect(json.correcao_id).toMatch(/^corr-/);
  expect(ctx.estado.correcoes).toHaveLength(1);
  expect(ctx.estado.correcoes[0]).toMatchObject({ estado: 'pendente_rh', autor_id: 'p-gestor' });
  expect(ctx.estado.marcacoes.size).toBe(0);
});
