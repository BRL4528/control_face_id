import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanteNoFuso, diaNoFuso } from '../../api/_lib/dia.js';
import { statementsLancamento, noFuturo } from '../../api/_lib/lancamento.js';
import { montarComentarioLancamento } from '../../api/_lib/bitrix-saida.js';

test('instanteNoFuso: relógio de Campo Grande (UTC-4) vira UTC', () => {
  assert.equal(instanteNoFuso('2026-10-05', '07:00', 'America/Campo_Grande'), '2026-10-05T11:00:00.000Z');
  assert.equal(instanteNoFuso('2026-10-05', '21:30', 'America/Campo_Grande'), '2026-10-06T01:30:00.000Z');
  assert.equal(instanteNoFuso('2026-10-05', '07:00', 'UTC'), '2026-10-05T07:00:00.000Z');
});

test('instanteNoFuso: ida e volta com o dia no fuso e entradas inválidas', () => {
  const iso = instanteNoFuso('2026-10-05', '23:50', 'America/Campo_Grande');
  assert.equal(diaNoFuso(iso, 'America/Campo_Grande'), '2026-10-05');
  assert.equal(instanteNoFuso('2026-13-40', '07:00', 'UTC'), instanteNoFuso('2026-13-40', '07:00', 'UTC'));   // não lança
  assert.equal(instanteNoFuso('05/10/2026', '07:00', 'UTC'), null);
  assert.equal(instanteNoFuso('2026-10-05', '7h', 'UTC'), null);
});

test('noFuturo: passado e agora valem; amanhã não', () => {
  assert.equal(noFuturo(new Date().toISOString()), false);
  assert.equal(noFuturo(new Date(Date.now() - 86400000).toISOString()), false);
  assert.equal(noFuturo(new Date(Date.now() + 86400000).toISOString()), true);
});

test('statementsLancamento: grava marcação manual aceita + correção de aprovação', () => {
  const chamadas = [];
  const txn = (partes, ...vals) => { chamadas.push({ sql: partes.join('?'), vals }); return {}; };
  const { idCliente, stmts } = statementsLancamento(txn, { empresaId: 'e1', colaboradorId: 'c1', equipeId: null, tipo: 'saida',
    marcadoEm: '2026-10-05T21:00:00.000Z', dia: '2026-10-05', motivo: 'esqueceu de bater', rhId: 'u1' });
  assert.equal(stmts.length, 2);
  assert.match(chamadas[0].sql, /INSERT INTO marcacao/); assert.match(chamadas[0].sql, /'manual'/);
  assert.ok(chamadas[0].vals.includes('saida') && chamadas[0].vals.includes('esqueceu de bater'));
  assert.match(chamadas[1].sql, /INSERT INTO correcao/); assert.ok(chamadas[1].vals.includes(idCliente));
});

test('comentário do Bitrix: lançamento, anulação e correção trazem justificativa e ids', () => {
  const base = { decisao: 'esqueceu de bater a saída', rh: 'RH', fuso: 'America/Campo_Grande', alvoId: 'm-9', agora: new Date('2026-10-06T12:00:00Z') };
  const l = montarComentarioLancamento({ ...base, acao: 'lancar', novo: { tipo: 'saida', marcado_em: '2026-10-05T21:00:00Z' } });
  assert.ok(l.includes('LANÇAMENTO') && l.includes('Saída em 05/10/2026') && l.includes('m-9') && l.includes('esqueceu'));
  const c = montarComentarioLancamento({ ...base, acao: 'corrigir', original: { tipo: 'entrada', marcado_em: '2026-10-05T11:00:00Z' }, novo: { tipo: 'saida', marcado_em: '2026-10-05T21:00:00Z' } });
  assert.ok(c.includes('CORRIGIDO') && c.includes('Registro original:') && c.includes('Registro novo:'));
  assert.ok(montarComentarioLancamento({ ...base, acao: 'anular', original: { tipo: 'entrada', marcado_em: '2026-10-05T11:00:00Z' } }).includes('ANULADO'));
});
