import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonCanonico, hashDaFolha } from '../../api/_lib/folha.js';

test('hash da folha não depende da ordem das chaves e muda com o conteúdo', () => {
  const a = { mes: '2026-10', totais: { extra: 60, faltas: 1 }, dias: [{ num: 1, batidas: ['07:00'] }] };
  const b = { dias: [{ batidas: ['07:00'], num: 1 }], totais: { faltas: 1, extra: 60 }, mes: '2026-10' };
  assert.equal(jsonCanonico(a), jsonCanonico(b));
  assert.equal(hashDaFolha(a), hashDaFolha(b));
  assert.equal(hashDaFolha(a).length, 64);
  assert.notEqual(hashDaFolha(a), hashDaFolha({ ...a, totais: { extra: 61, faltas: 1 } }));
});
