// Contrato de /efrat/marcacoes quando o aparelho não está ativo —
// docs/fase3-contrato.md §1.6 e §3.3.3. Cartão: T-D00CE0.
//
// O achado do QA que este arquivo fecha: hoje /efrat/marcacoes não olha o
// estado do aparelho, e no cliente um item rejeitado nunca saía da fila
// (retentativa infinita e silenciosa). A regra nova separa QUANDO a
// marcação aconteceu de QUANDO ela subiu: nunca 403, sempre 200 item a
// item, e os quatro status (aceito/duplicado/retido/rejeitado) sempre
// tiram o item da fila de envio do aparelho.
//
// Nível de contrato (chamada direta à rota), não de tela — a tela agrupada
// por aparelho (js/rh.js pintarPendencias) é coberta em outro arquivo.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';

const CREDENCIAL = 'credencial-de-teste';
let ctx;

function seedDispositivo(overrides) {
  ctx.estado.dispositivos.set('disp-1', Object.assign({
    dispositivo_id: 'disp-1',
    credencial_hash: crypto.createHash('sha256').update(CREDENCIAL).digest('base64url'),
    estado: 'ativo', codigo_curto: null, apelido: 'Tablet Obra Norte', ua: 'teste',
    geo: null, tentativas: 1, equipes_ids: ['eq-1'], configuracao_versao: 1
  }, overrides));
}

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
  seedDispositivo({});
});
test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

function marcacao(overrides) {
  return Object.assign({
    id_cliente: 'm-' + crypto.randomUUID(), pessoa_id: 'p-ana',
    tipo: 'entrada', marcado_em: new Date().toISOString(),
    veredito: 'aceito', origem: 'biometria', deriva_relogio_ms: 0
  }, overrides);
}

async function enviar(request, marcacoes) {
  const r = await request.post(`${ctx.base}/efrat/marcacoes`, {
    headers: { Authorization: `Bearer ${CREDENCIAL}` },
    data: { dispositivo_id: 'disp-1', marcacoes }
  });
  return { status: r.status(), json: await r.json() };
}

test('aparelho ativo: fluxo normal, aceito, sem motivo_codigo', async ({ request }) => {
  const { status, json } = await enviar(request, [marcacao({})]);
  expect(status).toBe(200);
  expect(json.resultados[0].status).toBe('aceito');
  expect(json.resultados[0].motivo_codigo).toBeUndefined();
});

test('aparelho revogado dentro da janela: retido, nunca 403, motivo_codigo aparelho_revogado', async ({ request }) => {
  seedDispositivo({ estado: 'revogado', revogado_em: new Date().toISOString() });
  const { status, json } = await enviar(request, [marcacao({})]);
  expect(status).toBe(200);
  expect(json.resultados[0].status).toBe('retido');
  expect(json.resultados[0].motivo_codigo).toBe('aparelho_revogado');
  expect(json.resumo.retidas).toBe(1);
  const gravada = [...ctx.estado.marcacoes.values()][0];
  expect(gravada.aparelho_estado_no_envio).toBe('revogado');
  expect(gravada.aparelho_apelido).toBe('Tablet Obra Norte');
  expect(gravada.requer_revisao).toBe(true);
});

test('aparelho revogado ha mais de 30 dias: rejeitado, janela_de_drenagem_encerrada, nao grava', async ({ request }) => {
  const trintaEUmDias = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  seedDispositivo({ estado: 'revogado', revogado_em: trintaEUmDias });
  const { status, json } = await enviar(request, [marcacao({})]);
  expect(status).toBe(200);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('janela_de_drenagem_encerrada');
  expect(ctx.estado.marcacoes.size).toBe(0);
});

test('aparelho revogado com 500 marcacoes retidas: teto estoura e vira rejeitado', async ({ request }) => {
  seedDispositivo({ estado: 'revogado', revogado_em: new Date().toISOString(), retidasPosRevogacao: 500 });
  const { json } = await enviar(request, [marcacao({})]);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('limite_pos_revogacao');
});

test('aparelho pendente: rejeitado, aparelho_nunca_liberado', async ({ request }) => {
  seedDispositivo({ estado: 'pendente' });
  const { json } = await enviar(request, [marcacao({})]);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('aparelho_nunca_liberado');
});

test('aparelho negado: rejeitado, aparelho_nunca_liberado', async ({ request }) => {
  seedDispositivo({ estado: 'negado' });
  const { json } = await enviar(request, [marcacao({})]);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('aparelho_nunca_liberado');
});

test('pessoa desconhecida: rejeitado, pessoa_desconhecida, aparelho ativo nao muda isso', async ({ request }) => {
  const { json } = await enviar(request, [marcacao({ pessoa_id: 'p-fantasma' })]);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('pessoa_desconhecida');
});

test('duplicado vence estado do aparelho: id_cliente ja conhecido nunca vira retido/rejeitado', async ({ request }) => {
  const m = marcacao({});
  await enviar(request, [m]);
  seedDispositivo({ estado: 'revogado', revogado_em: new Date().toISOString() });
  const { json } = await enviar(request, [m]);
  expect(json.resultados[0].status).toBe('duplicado');
});

test('resumo conta os quatro status corretamente num lote misto', async ({ request }) => {
  // Aparelho revogado decide pelo ESTADO DO APARELHO primeiro — mesmo um
  // item de pessoa desconhecida vira retido/rejeitado por causa do
  // aparelho, nunca chega a olhar a pessoa. Faz sentido: um aparelho não
  // confiável não fica mais confiável só porque inventou um pessoa_id real.
  seedDispositivo({ estado: 'revogado', revogado_em: new Date().toISOString() });
  const retida = marcacao({});
  await enviar(request, [retida]); // grava 1 retida
  const { json } = await enviar(request, [retida, marcacao({ pessoa_id: 'p-fantasma' })]);
  expect(json.resumo).toMatchObject({ duplicadas: 1, retidas: 1, rejeitadas: 0, aceitas: 0 });
});

test('aparelho ativo com pessoa desconhecida: rejeitado por pessoa, nao por aparelho', async ({ request }) => {
  const { json } = await enviar(request, [marcacao({ pessoa_id: 'p-fantasma' })]);
  expect(json.resultados[0].status).toBe('rejeitado');
  expect(json.resultados[0].motivo_codigo).toBe('pessoa_desconhecida');
});
