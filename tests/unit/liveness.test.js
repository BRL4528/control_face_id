import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarDetectorPiscada } from '../../js/liveness.js';

const roda = (det, seq) => seq.some(v => det.alimentar(v));

test('olho que fecha pouco (EAR 0,26 → 0,19) passa: o limiar fixo antigo (0,18) reprovava', () => {
  const det = criarDetectorPiscada([0.26, 0.27, 0.25, 0.26]);
  assert.equal(roda(det, [0.26, 0.19, 0.18, 0.25]), true);
});

test('foto parada (ruído de landmarks ±5%) nunca completa', () => {
  const det = criarDetectorPiscada([0.25, 0.26, 0.24]);
  const ruido = Array.from({ length: 40 }, (_, i) => 0.25 + (i % 3 - 1) * 0.012);
  assert.equal(roda(det, ruido), false);
});

test('sem quadros anteriores, os 3 primeiros formam a linha de base', () => {
  const det = criarDetectorPiscada([]);
  assert.equal(roda(det, [0.3, 0.31, 0.3]), false);
  assert.ok(Math.abs(det.base - 0.3) < 1e-9);
  assert.equal(roda(det, [0.2, 0.29]), true);
});

test('fechou e não reabriu ainda não completa; ignora EAR inválido', () => {
  const det = criarDetectorPiscada([0.3, 0.3, 0.3]);
  assert.equal(roda(det, [0.2, NaN, 0, 0.21]), false);
  assert.equal(det.alimentar(0.28), true);
});

test('diagnóstico: linha de base, menor abertura e quadros analisados', () => {
  const det = criarDetectorPiscada([0.3, 0.3, 0.3]);
  [0.29, 0.27, 0.28].forEach(v => det.alimentar(v));
  assert.deepEqual(det.diagnostico, { base: 0.3, minimo: 0.27, quadros: 3 });
});
