import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertasDaEntrega, nomeComCodigo, podeCancelarEntrega } from '../../js/almox.js';

test('EPI: CA vencido na entrega e troca pela vida útil', () => {
  const luva = { tipo: 'epi', ca_validade: '2026-12-31', vida_util_dias: 30 };
  const e = { entregue_em: '2026-10-01', estado: 'confirmada' };
  assert.deepEqual(alertasDaEntrega(e, luva, '2026-10-20').alertas, []);
  assert.deepEqual(alertasDaEntrega(e, luva, '2026-10-25').alertas, ['trocar_em_breve']);
  assert.deepEqual(alertasDaEntrega(e, luva, '2026-10-31').alertas, ['trocar']);
  assert.equal(alertasDaEntrega(e, luva, '2026-10-31').troca_em, '2026-10-31');
  assert.deepEqual(alertasDaEntrega(e, { ...luva, ca_validade: '2026-09-30' }, '2026-10-02').alertas, ['ca_vencido']);
});

test('ferramenta: atraso na devolução; devolvida não alerta', () => {
  const furadeira = { tipo: 'ferramenta' };
  const e = { entregue_em: '2026-10-01', devolver_ate: '2026-10-10', estado: 'confirmada' };
  assert.deepEqual(alertasDaEntrega(e, furadeira, '2026-10-10').alertas, []);
  assert.deepEqual(alertasDaEntrega(e, furadeira, '2026-10-11').alertas, ['atrasada']);
  assert.deepEqual(alertasDaEntrega({ ...e, estado: 'devolvida' }, furadeira, '2026-10-20').alertas, []);
});

test('EPI trocado: entrega substituída por outra mais nova do mesmo item não pede troca', async () => {
  const { entregaSubstituida, caVencidoEm } = await import('../../js/almox.js');
  const luva = { tipo: 'epi', vida_util_dias: 30 };
  const velha = { id: 'e1', item_id: 'luva', colaborador_id: 'p1', entregue_em: '2026-09-01', estado: 'confirmada' };
  const nova = { id: 'e2', item_id: 'luva', colaborador_id: 'p1', entregue_em: '2026-10-01', estado: 'aguardando_ciencia' };
  const outroItem = { id: 'e3', item_id: 'bota', colaborador_id: 'p1', entregue_em: '2026-10-05', estado: 'confirmada' };
  const outraPessoa = { id: 'e4', item_id: 'luva', colaborador_id: 'p2', entregue_em: '2026-10-05', estado: 'confirmada' };
  assert.deepEqual(alertasDaEntrega(velha, luva, '2026-10-20').alertas, ['trocar']);   // sem lista: comportamento antigo
  const r = alertasDaEntrega(velha, luva, '2026-10-20', [velha, nova, outroItem, outraPessoa]);
  assert.deepEqual([r.alertas, r.substituida], [[], true]);
  assert.deepEqual(alertasDaEntrega(nova, luva, '2026-10-20', [velha, nova]).alertas, []);   // a nova ainda vale
  assert.deepEqual(alertasDaEntrega(velha, luva, '2026-10-20', true).alertas, []);           // flag já calculada
  // troca cancelada não substitui; outro item e outra pessoa também não
  assert.equal(entregaSubstituida(velha, [{ ...nova, estado: 'cancelada' }, outroItem, outraPessoa]), false);
  // CA vencido continua aparecendo mesmo substituída (fato da entrega)
  assert.deepEqual(alertasDaEntrega(velha, { ...luva, ca_validade: '2026-08-01' }, '2026-10-20', [velha, nova]).alertas, ['ca_vencido']);
  // ferramenta emprestada de novo não é "substituída": a anterior continua com a pessoa
  const furadeira = { tipo: 'ferramenta' };
  const f1 = { id: 'f1', item_id: 'fur', colaborador_id: 'p1', entregue_em: '2026-09-01', devolver_ate: '2026-09-10', estado: 'confirmada' };
  const f2 = { ...f1, id: 'f2', entregue_em: '2026-10-01', devolver_ate: '2026-10-30' };
  const rf = alertasDaEntrega(f1, furadeira, '2026-10-20', [f1, f2]);
  assert.deepEqual([rf.alertas, rf.substituida], [['atrasada'], false]);
  assert.equal(caVencidoEm({ tipo: 'epi', ca_validade: '2026-10-01' }, '2026-10-02'), true);
  assert.equal(caVencidoEm({ tipo: 'epi', ca_validade: '2026-10-01' }, '2026-10-01'), false);
  assert.equal(caVencidoEm({ tipo: 'ferramenta', ca_validade: '2026-10-01' }, '2026-10-02'), false);
});

test('nomeComCodigo junta o código ou patrimônio ao nome', () => {
  assert.equal(nomeComCodigo({ nome: 'Furadeira', codigo: 'PAT-1' }), 'Furadeira (PAT-1)');
  assert.equal(nomeComCodigo({ nome: 'Luva', codigo: '  ' }), 'Luva');
  assert.equal(nomeComCodigo({ nome: 'Bota' }), 'Bota');
  assert.equal(nomeComCodigo(null), '?');
});

test('só entrega aguardando confirmação pode ser cancelada', () => {
  assert.equal(podeCancelarEntrega({ estado: 'aguardando_ciencia' }), true);
  assert.equal(podeCancelarEntrega({ estado: 'confirmada' }), false);
  assert.equal(podeCancelarEntrega({ estado: 'devolvida' }), false);
  assert.equal(podeCancelarEntrega({ estado: 'cancelada' }), false);
  assert.equal(podeCancelarEntrega(null), false);
});
