import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reforcarVetores, vetorValido, MAX_VETORES } from '../../api/_lib/reforco.js';
import { normalizarBatida } from '../../api/_lib/batida.js';

// Vetor de 128 dims com o valor `v` na 1ª posição: a distância entre dois é |v1 - v2|.
const vet = v => [v].concat(Array(127).fill(0));

test('vetorValido: só 128 números finitos', () => {
  assert.ok(vetorValido(vet(0.1)));
  assert.equal(vetorValido(vet(0.1).slice(1)), null);
  assert.equal(vetorValido([NaN].concat(Array(127).fill(0))), null);
  assert.equal(vetorValido('x'), null);
});

test('reforço: vetor da mesma pessoa (zona cinzenta) entra no template', () => {
  const r = reforcarVetores([vet(0), vet(0.1)], vet(0.5));
  assert.equal(r.vetores.length, 3);
  assert.equal(r.vetores[2][0], 0.5);
});

test('reforço: longe de todos (outra pessoa) é recusado; quase igual não acrescenta', () => {
  assert.deepEqual(reforcarVetores([vet(0)], vet(0.7)), { erro: 'longe' });
  assert.deepEqual(reforcarVetores([vet(0)], vet(0.01)), { erro: 'repetido' });
  assert.deepEqual(reforcarVetores([], vet(0.3)), { erro: 'invalido' });
  assert.deepEqual(reforcarVetores([vet(0)], [1, 2]), { erro: 'invalido' });
});

test('reforço: no máximo 8 vetores, o 1º do cadastro fica e sai o reforço mais antigo', () => {
  let vs = [vet(0)];
  for (let i = 1; i <= 10; i++) vs = reforcarVetores(vs, vet(i * 0.06)).vetores || vs;
  assert.equal(vs.length, MAX_VETORES);
  assert.equal(vs[0][0], 0);
  assert.ok(Math.abs(vs[vs.length - 1][0] - 0.6) < 1e-9);
});

test('batida: vetor do rosto só segue na zona cinzenta e se for válido', () => {
  const b = { id_cliente: 'x1', tipo: 'entrada', marcado_em: '2026-11-04T11:00:00Z', descritor: vet(0.2) };
  assert.ok(normalizarBatida({ ...b, veredito: 'revisar' }).item.descritor);
  assert.equal(normalizarBatida({ ...b, veredito: 'aceito' }).item.descritor, null);
  assert.equal(normalizarBatida({ ...b, veredito: 'revisar', descritor: [1] }).item.descritor, null);
});
