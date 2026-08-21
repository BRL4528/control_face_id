// Contrato de POST /efrat/rh/aparelhos — docs/fase3-contrato.md §1.2.
// Cartão: T-C20AD3.
//
// Achado do Orquestrador revisando o cartão: separarAparelhos() (js/regras.js)
// morreu junto com seus 4 testes unitários quando pintarAparelhos() passou a
// consumir a leitura nova do servidor em vez do array `dispositivos` que
// existia em /rh/dados — mas a ORDENAÇÃO que aquela função garantia (e que os
// 4 testes provavam) virou lógica só do servidor, sem nenhuma afirmação em
// nível de contrato. "Função morta removida" e "comportamento que ninguém
// mais afirma" são coisas diferentes, e só a primeira era verdade — a segunda
// ficou como dívida sem ninguém perceber, porque a suite ficava verde do
// mesmo jeito. Este arquivo fecha essa dívida.
//
// Por que a ordem importa de verdade, não é só polimento — e onde exatamente
// (correção do próprio Orquestrador sobre o motivo, não sobre o teste): a
// ordem NÃO governa aprovação — aprovar é só por código digitado, a lista não
// dirige nada, e o teste do QA em aparelho-liberacao.spec.js existe
// justamente pra garantir que ela nunca volte a dirigir. Onde a ordem decide
// de verdade é em RECUSAR: cada pendente tem "Recusar" próprio, e no cenário
// de enxurrada (Cenário 1, ameacas-v3.md) a instrução ao RH é "se você só
// espera um, recuse os outros". Pedido antigo enterrado no meio de vinte
// forjados recém-chegados não dá erro — dá o RH recusando o legítimo por
// engano, ou deixando passar batido um forjado no meio da varredura.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { criarServidor } from './servidor-falso.js';

const RH = { usuario: 'rh', chave: 'CHAVE-DE-TESTE' };
let ctx;

function seedDispositivo(id, overrides) {
  ctx.estado.dispositivos.set(id, Object.assign({
    dispositivo_id: id,
    credencial_hash: crypto.createHash('sha256').update('cred-' + id).digest('base64url'),
    estado: 'pendente', codigo_curto: null, apelido: 'Aparelho ' + id, ua: 'teste',
    geo: null, tentativas: 1, equipes_ids: [], configuracao_versao: 0,
    pendente_id: 'pend-' + id, primeiro_pedido_em: new Date().toISOString(),
    ultimo_pedido_em: new Date().toISOString(), ip_hash: 'hash-' + id
  }, overrides));
}

test.beforeEach(async () => {
  const { servidor, estado } = criarServidor({});
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  ctx = { servidor, estado, base: `http://127.0.0.1:${servidor.address().port}/webhook` };
});
test.afterEach(async () => { await new Promise(resolve => ctx.servidor.close(resolve)); });

async function lerAparelhos(request) {
  const r = await request.post(`${ctx.base}/efrat/rh/aparelhos`, { data: RH });
  return (await r.json());
}

/**
 * Registra pela rota pública de verdade (não via seedDispositivo) — é o
 * único jeito de exercitar o cálculo real de ip_hash, que só roda dentro do
 * handler de /registrar. `ip` vira `estado.ipSimulado` antes da chamada
 * (achado do DevOps: estado, não cabeçalho — não existe artefato com forma
 * de protocolo pra alguém copiar pro workflow real do n8n).
 */
async function registrar(request, { apelido = 'Tablet', ip } = {}) {
  ctx.estado.ipSimulado = ip;
  const r = await request.post(`${ctx.base}/efrat/dispositivo/registrar`, {
    data: {
      dispositivo_id: crypto.randomUUID(),
      credencial_publica: crypto.createHash('sha256').update(crypto.randomUUID()).digest('base64url'),
      apelido, ua: 'teste'
    }
  });
  return await r.json();
}

test('pendentes vêm do mais antigo pedido para o mais novo — quem espera há mais tempo aparece primeiro', async ({ request }) => {
  seedDispositivo('novo', { criado_em: '2026-08-19T10:00:00Z' });
  seedDispositivo('antigo', { criado_em: '2026-08-15T10:00:00Z' });
  seedDispositivo('meio', { criado_em: '2026-08-17T10:00:00Z' });

  const { pendentes } = await lerAparelhos(request);

  expect(pendentes.map(p => p.apelido_declarado)).toEqual(['Aparelho antigo', 'Aparelho meio', 'Aparelho novo']);
});

test('ativos vêm do uso mais recente para o mais antigo, e quem nunca usou vai para o fim', async ({ request }) => {
  seedDispositivo('usado-ha-pouco', { estado: 'ativo', ultimo_uso: '2026-08-19T10:00:00Z' });
  seedDispositivo('nunca-usado', { estado: 'ativo', ultimo_uso: null });
  seedDispositivo('usado-faz-tempo', { estado: 'ativo', ultimo_uso: '2026-08-01T10:00:00Z' });

  const { ativos } = await lerAparelhos(request);

  expect(ativos.map(a => a.dispositivo_id)).toEqual(['usado-ha-pouco', 'usado-faz-tempo', 'nunca-usado']);
});

test('pendentes e ativos nunca se misturam numa lista só, mesmo com os dois presentes ao mesmo tempo', async ({ request }) => {
  seedDispositivo('p1', { estado: 'pendente' });
  seedDispositivo('a1', { estado: 'ativo', ultimo_uso: null });

  const { pendentes, ativos } = await lerAparelhos(request);

  expect(pendentes.map(p => p.pendente_id)).toEqual(['pend-p1']);
  expect(ativos.map(a => a.dispositivo_id)).toEqual(['a1']);
});

/* --------------------------------------------- pedidos_da_mesma_rede_1h */
// §1.2: contagem OBSERVADA pelo servidor (ip_hash na última hora), não
// declarada pelo cliente — sinal de flood (Cenário 1, ameacas-v3.md).
// Achado do Orquestrador: a invariante existia em código e não tinha teste
// nenhum provando o número — "invariante sem teste é invariante que a gente
// acha que tem".
//
// Guarda de MECANISMO, achado do Arquiteto — o que estes dois testes provam
// e o que não provam: com `estado.ipSimulado` eles provam a AGREGAÇÃO (dois
// IPs diferentes não somam, dois do mesmo IP somam). NÃO provam que o n8n
// real enxerga o IP real do cliente — isso depende de não haver proxy na
// frente (verdade hoje, confirmada pelo cliente). Se um proxy for
// introduzido, `ip_hash` vira constante (o do proxy), o campo passa a
// contar o mundo inteiro como "mesma rede", o aviso acende SEMPRE — e estes
// dois testes continuam verdes, porque injetam o IP em vez de observar a
// topologia real. Se isso mudar, reavaliar §1.2 ANTES, degradando para
// `pedidos_pendentes_1h` sem a palavra "internet" (o contrato já tem a
// regra e o gatilho — falta só o ponteiro aqui, onde o verde é lido).

test('tres pedidos da mesma rede contam tres no campo de cada um, nunca declarado pelo cliente', async ({ request }) => {
  await registrar(request, { apelido: 'Tablet 1', ip: '203.0.113.10' });
  await registrar(request, { apelido: 'Tablet 2', ip: '203.0.113.10' });
  await registrar(request, { apelido: 'Tablet 3', ip: '203.0.113.10' });

  const { pendentes } = await lerAparelhos(request);
  expect(pendentes).toHaveLength(3);
  for (const p of pendentes) expect(p.pedidos_da_mesma_rede_1h).toBe(3);
});

test('pedidos de redes diferentes não se contam entre si', async ({ request }) => {
  await registrar(request, { apelido: 'Tablet Norte', ip: '203.0.113.10' });
  await registrar(request, { apelido: 'Tablet Sul A', ip: '198.51.100.20' });
  await registrar(request, { apelido: 'Tablet Sul B', ip: '198.51.100.20' });

  const { pendentes } = await lerAparelhos(request);
  const norte = pendentes.find(p => p.apelido_declarado === 'Tablet Norte');
  const sulA = pendentes.find(p => p.apelido_declarado === 'Tablet Sul A');
  const sulB = pendentes.find(p => p.apelido_declarado === 'Tablet Sul B');

  expect(norte.pedidos_da_mesma_rede_1h).toBe(1);
  expect(sulA.pedidos_da_mesma_rede_1h).toBe(2);
  expect(sulB.pedidos_da_mesma_rede_1h).toBe(2);
});
