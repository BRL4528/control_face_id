// Procedência do template gravado por /efrat/cadastro (T-8ADD9C, achado do
// Orquestrador sobre docs/fase3-seguranca.md § 5.1a): o campo `coerencia` sai
// do CORPO da requisição (o cliente não escolhe mais o próprio veredito), mas
// o servidor precisa PERSISTIR e DEVOLVER o valor que ele calculou — senão
// js/rh.js:358 ('coerência ' + (t.coerencia == null ? '—' : ...)) mostra "—"
// pra sempre na fila de recadastro do RH, que é a única compensação humana
// pela ausência de liveness no cadastro (docs/fase3-seguranca.md § 5).
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';
import { loteMesmaPessoa, maiorDistanciaParAPar } from './fixtures-biometria.js';

const CREDENCIAL = 'credencial-de-teste';

let ctx;

test.beforeEach(async () => {
  const { servidor, estado, pessoas } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, pessoas, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
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
    data: Object.assign({ dispositivo_id: 'disp-1', miniatura: '' }, corpo),
    failOnStatusCode: false
  });
}

test('cadastro via RH grava origem e coerência calculada, para procedência (§ 5.1a)', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const r = await cadastrar(request, { origem: 'rh', nome: 'Ana', matricula: 'M-PROV-RH', equipe_id: 'eq-1', vetores });
  const corpo = await r.json();

  expect(corpo.ok).toBe(true);
  expect(corpo.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);

  const gravado = ctx.pessoas.find(p => p.matricula === 'M-PROV-RH');
  expect(gravado.origem).toBe('rh');
  expect(gravado.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);
  expect(gravado.criado_em).toBeTruthy();
});

test('cadastro pendente (caminho do gestor) entra na fila do RH já com a coerência calculada', async ({ request }) => {
  const vetores = loteMesmaPessoa();
  const r = await cadastrar(request, {
    origem: 'gestor', pessoa_id: 'p-ana', nome: 'Ana Souza', matricula: '001', equipe_id: 'eq-1', vetores
  });
  const corpo = await r.json();
  expect(corpo.ok).toBe(true);
  expect(corpo.status).toBe('pendente');

  const dados = await (await request.post(`${ctx.base}/efrat/rh/dados`, {
    data: { usuario: 'rh', chave: 'CHAVE-DE-TESTE', dias: 30 }
  })).json();

  const pendencia = dados.recadastros.find(t => t.pessoa_id === 'p-ana');
  expect(pendencia, 'o recadastro do gestor precisa aparecer na fila do RH').toBeTruthy();
  // Sem isso, js/rh.js:358 mostra "coerência —" pra sempre — o único número
  // que o RH tem na fila humana que compensa a ausência de liveness.
  expect(pendencia.coerencia).not.toBeNull();
  expect(pendencia.coerencia).toBeCloseTo(maiorDistanciaParAPar(vetores), 9);
});
