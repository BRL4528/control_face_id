import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarDetectorGiro } from '../../js/liveness.js';

const roda = (det, seq) => seq.some(v => det.alimentar(v));

test('virou o rosto (para qualquer lado) e voltou: passa', () => {
  assert.equal(roda(criarDetectorGiro([0.02, 0.03]), [0.03, 0.12, 0.28, 0.31, 0.15, 0.04]), true);
  assert.equal(roda(criarDetectorGiro([0.02, 0.03]), [0.0, -0.2, -0.25, 0.01]), true);
});

test('foto parada (ruído de landmarks) nunca completa', () => {
  const det = criarDetectorGiro([0.04, 0.05, 0.03]);
  const ruido = Array.from({ length: 40 }, (_, i) => 0.04 + (i % 5 - 2) * 0.02);
  assert.equal(roda(det, ruido), false);
});

test('virou e não voltou ainda não completa; sem base, os 2 primeiros quadros formam a base', () => {
  const det = criarDetectorGiro([]);
  assert.equal(roda(det, [0.05, 0.05, 0.3, 0.32]), false);
  assert.equal(det.alimentar(0.06), true);
  assert.ok(Math.abs(det.base - 0.05) < 1e-9);
});

test('diagnóstico: base, maior desvio e quadros', () => {
  const det = criarDetectorGiro([0.1, 0.1]);
  [0.12, 0.2, 0.15].forEach(v => det.alimentar(v));
  const d = det.diagnostico;
  assert.equal(d.base, 0.1); assert.equal(d.quadros, 3); assert.ok(Math.abs(d.maior_desvio - 0.1) < 1e-9);
});

test('giro de 0,12 já conta (limiar de 04/11) e a fase acompanha', () => {
  const det = criarDetectorGiro([0.02, 0.03]);
  assert.equal(det.fase, 'aguardando_virar');
  det.alimentar(0.10); assert.equal(det.fase, 'aguardando_virar');
  det.alimentar(0.15); assert.equal(det.fase, 'aguardando_voltar');
  assert.equal(det.alimentar(0.04), true);
  assert.equal(det.fase, 'completo');
});
