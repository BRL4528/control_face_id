import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertasDaEntrega } from '../../js/almox.js';

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
