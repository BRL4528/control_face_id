import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prazoCat, situacaoCat } from '../../js/eventos.js';

test('prazo da CAT: 1º dia útil seguinte, pulando fim de semana e feriado', () => {
  assert.equal(prazoCat('2026-10-27'), '2026-10-28');   // terça → quarta
  assert.equal(prazoCat('2026-10-09'), '2026-10-13');   // sexta → (sáb, dom, 12/10 feriado) → terça
  assert.equal(prazoCat('2026-08-25', [{ dia: '2026-08-26', nome: 'Campo Grande' }]), '2026-08-27');
  assert.equal(prazoCat('2026-12-31'), '2027-01-04');   // virada de ano: 01/01 feriado, 02–03 fim de semana
});

test('situação do prazo', () => {
  const ev = { data: '2026-10-27' };
  assert.equal(situacaoCat(ev, '2026-10-27').situacao, 'no_prazo');
  assert.equal(situacaoCat(ev, '2026-10-28').situacao, 'vence_hoje');
  assert.equal(situacaoCat(ev, '2026-10-29').situacao, 'atrasada');
});

test('rota de tabela nova antes da migração responde 503, não 500', async () => {
  const { faltaTabela, comTabelaNova } = await import('../../api/_lib/tabela-nova.js');
  assert.equal(faltaTabela(new Error('relation "evento" does not exist')), true);
  assert.equal(faltaTabela(new Error('timeout')), false);
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
    setHeader() {}, end() {} };
  await comTabelaNova(res, async () => { throw new Error('relation "evento" does not exist'); });
  assert.equal(res.statusCode, 503);
  await assert.rejects(comTabelaNova(res, async () => { throw new Error('outro erro'); }));
});
