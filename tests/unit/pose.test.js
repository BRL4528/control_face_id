// Gate de pose do enrollment — as duas propriedades medidas em T-5EC67B.
//
// Importa de js/regras.js e NÃO de js/face.js de propósito: face.js faz
// `document.createElement` no topo do módulo, então não importa em Node de
// jeito nenhum. Exportar `yaw` de lá, sozinho, não abre costura — a função
// precisa morar no módulo puro, que é onde a própria casa manda pôr regra sem
// DOM ("Regras puras — sem DOM, sem rede, sem IndexedDB. Fica separado
// justamente para ser testável em Node", js/regras.js:1-3).
//
// NASCE VERMELHO enquanto `yaw` não estiver em regras.js. O vermelho é o
// pedido, não um defeito do motor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const regras = await import('../../js/regras.js');

/** Rosto de frente: olho esquerdo, olho direito, ponta do nariz. */
function base() {
  const p = [];
  p[36] = { x: 100, y: 150, z: 0 };
  p[45] = { x: 200, y: 150, z: 0 };
  p[30] = { x: 150, y: 190, z: 20 };
  return { positions: p };
}

/** Queixo baixo: rotação no eixo HORIZONTAL. Mexe y e z, nunca x. */
function queixoBaixo(graus) {
  const p = base().positions, r = graus * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), o = [];
  for (const i of [36, 45, 30]) {
    o[i] = { x: p[i].x, y: p[i].y * c - p[i].z * s, z: p[i].y * s + p[i].z * c };
  }
  return { positions: o };
}

/** Cabeça virada: rotação no eixo VERTICAL. Mexe x — é o que o gate vê. */
function cabecaVirada(graus) {
  const p = base().positions, r = graus * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), cx = 150, o = [];
  for (const i of [36, 45, 30]) {
    o[i] = { x: cx + (p[i].x - cx) * c + p[i].z * s, y: p[i].y, z: -(p[i].x - cx) * s + p[i].z * c };
  }
  return { positions: o };
}

test('yaw() mora no módulo puro, senão não há como afirmar nada sobre pose', () => {
  assert.equal(typeof regras.yaw, 'function',
    'yaw precisa ser exportada de js/regras.js — em js/face.js ela é inalcançável ' +
    'em Node porque o módulo faz document.createElement no topo');
});

test('PROPRIEDADE 1 (algébrica): o gate é cego a queixo baixo, em qualquer ângulo', () => {
  // A fórmula lê apenas coordenadas x; queixo baixo desloca y e z. A
  // invariância não é frouxidão de limiar, é a métrica não existir.
  // Este teste não tem tolerância de ponto flutuante por acaso: o valor tem de
  // ser IDÊNTICO ao do rosto de frente, não só parecido.
  const frente = regras.yaw(base());
  for (const graus of [10, 20, 30, 40]) {
    assert.equal(regras.yaw(queixoBaixo(graus)), frente,
      `${graus}° de queixo baixo mudaram yaw() — se este teste falhar, alguém ` +
      'adicionou percepção de pitch e o gate deixou de ser cego (boa notícia: ' +
      'troque esta asserção pela do limiar novo)');
  }
});

test('PROPRIEDADE 2 (indicativa): o gate de yaw só reprova perto de perfil', () => {
  // Ao contrário da 1, esta depende da geometria assumida (profundidade do
  // nariz z=20 para 100px entre olhos). O que é robusto é a ordem de
  // grandeza, não o ângulo exato — por isso a asserção é de faixa e não de
  // valor. maxYaw padrão é 0,30 (js/config.js).
  const LIMIAR = 0.30;
  assert.ok(Math.abs(regras.yaw(cabecaVirada(45))) < LIMIAR,
    '45° de cabeça virada passam pelo gate hoje — é o achado, não o defeito do teste');
  assert.ok(Math.abs(regras.yaw(cabecaVirada(60))) > LIMIAR,
    '60° reprovam: o gate existe, só está longe demais para servir ao enrollment');
});
