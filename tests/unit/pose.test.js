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

// O QUE ESTES TESTES NÃO COBREM, declarado porque teste que não pega uma classe
// tem de dizer que não pega — senão a próxima pessoa confia nele para isso.
//
// Eles NÃO detectam viés antropométrico na fórmula de pose. Medido: duas
// anatomias plausíveis, ambas perfeitamente de frente (pitch verdadeiro zero),
// dão leituras diferentes por fator ~2 tanto na forma absoluta
// ((nariz−olhos)/(RAZÃO·vão)) quanto na razão auto-normalizada
// ((nariz−olhos)/(queixo−nariz)). Nenhuma das duas tem zero natural: elas
// cancelam ESCALA (tamanho do rosto, distância da câmera) e não cancelam FORMA.
//
// A monotonicidade sobrevive a um deslocamento constante, e o teste de limiar só
// prova que o gate lê a config — então os dois ficariam VERDES com qualquer das
// duas fórmulas enviesadas. Pegar isso exigiria descritores de rostos com
// proporções diferentes, que o projeto não tem.
//
// Consequência de desenho (T-5EC67B): pitch ABSOLUTO em 2D não é mensurável sem
// assumir anatomia, e assumir anatomia no GATE é pior que no matcher — o matcher
// errado manda para revisão humana, o gate errado nem tenta. Diferença entre duas
// fotos da MESMA pessoa cancela o deslocamento exatamente (medido: zero exato nas
// duas anatomias), então consistência de pose entre as 3 fotos é respondível sem
// constante. Ver docs/validacao-biometrica.md:101 para o risco demográfico.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * cfg de teste. NAO importa js/config.js: aquele arquivo faz
 * `window.EFRAT_CFG = ...` e nao carrega em Node. E nao precisa importar — o
 * requisito e que o GATE leia o limiar do cfg que recebe, nao que este teste
 * conheca o numero. Por isso aqui o valor e arbitrario de proposito: se o gate
 * honrar este, honra o de produção.
 */
const cfg = (over = {}) => ({ maxYaw: 0.30, maxPitch: 0.25, ...over });

/** O texto de js/config.js, para afirmar que o campo EXISTE lá de verdade. */
const textoConfig = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'js', 'config.js'), 'utf8');

const regras = await import('../../js/regras.js');

/** Rosto de frente: olho esquerdo, olho direito, ponta do nariz. */
function base() {
  const p = [];
  p[36] = { x: 100, y: 150, z: 0 };   // canto externo do olho direito
  p[45] = { x: 200, y: 150, z: 0 };   // canto externo do olho esquerdo
  p[30] = { x: 150, y: 190, z: 20 };  // ponta do nariz — protrui
  p[8]  = { x: 150, y: 255, z: 5 };   // queixo (contorno da mandíbula) — protrui menos
  return { positions: p };
}

/** Queixo baixo: rotação no eixo HORIZONTAL. Mexe y e z, nunca x. */
function queixoBaixo(graus) {
  const p = base().positions, r = graus * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), o = [];
  for (const i of [36, 45, 30, 8]) {
    o[i] = { x: p[i].x, y: p[i].y * c - p[i].z * s, z: p[i].y * s + p[i].z * c };
  }
  return { positions: o };
}

/** Cabeça virada: rotação no eixo VERTICAL. Mexe x — é o que o gate vê. */
function cabecaVirada(graus) {
  const p = base().positions, r = graus * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r), cx = 150, o = [];
  for (const i of [36, 45, 30, 8]) {
    o[i] = { x: cx + (p[i].x - cx) * c + p[i].z * s, y: p[i].y, z: -(p[i].x - cx) * s + p[i].z * c };
  }
  return { positions: o };
}

test('yaw() mora no módulo puro, senão não há como afirmar nada sobre pose', () => {
  assert.equal(typeof regras.yaw, 'function',
    'yaw precisa ser exportada de js/regras.js — em js/face.js ela é inalcançável ' +
    'em Node porque o módulo faz document.createElement no topo');
});

// A forma exata da função de pose é decisão do contrato (T-5EC67B: UMA função
// devolvendo os dois eixos, limiares separados na config). Se o nome ou o
// formato mudarem, muda AQUI e em nada mais do arquivo — e o primeiro teste
// falha alto se o adaptador não casar, para a troca não falhar calada. Perdi
// tempo hoje com uma substituição de constante que falhou em silêncio.
const NOME_POSE = 'avaliarPose';   // esperado: (landmarks, cfg) -> { yaw, pitch, ok }

test('a função de pose existe e devolve os dois eixos num único decisor', () => {
  assert.equal(typeof regras[NOME_POSE], 'function',
    `${NOME_POSE} precisa existir em js/regras.js. Um decisor só, devolvendo yaw ` +
    'e pitch juntos: com duas checagens no chamador, alguém implementa ou remove ' +
    'metade e o gate passa a cobrir um eixo só.');
  const r = regras[NOME_POSE](base(), cfg());
  for (const campo of ['yaw', 'pitch', 'ok']) {
    assert.ok(campo in r, `a pose devolvida precisa ter '${campo}'`);
  }
});

test('PROPRIEDADE 1 (estrutural): a pose RESPONDE a queixo baixo — monotônica, sem número cravado', () => {
  // Esta assertiva SUBSTITUI a anterior, que afirmava o oposto: que o gate era
  // cego a pitch (yaw() lê só x, então queixo baixo dava 0,0000 em qualquer
  // ângulo). Aquela era verdadeira e mediu a lacuna; esta trava o conserto.
  // A troca é o que a mensagem de falha daquela mandava fazer quando a
  // percepção de pitch chegasse — ela chegou.
  //
  // MONOTONICIDADE e não valor: não temos medição de pitch de mesma pessoa em
  // população real, então cravar um corte aqui repetiria o 0,30 da coerência —
  // juízo virando teste, e depois o teste defendendo o juízo. O que sabemos com
  // certeza é a direção: mais queixo baixo, mais pitch.
  const graus = [0, 10, 20, 30, 40];
  const pitches = graus.map(g => Math.abs(regras[NOME_POSE](queixoBaixo(g), cfg()).pitch));

  for (let i = 1; i < pitches.length; i++) {
    assert.ok(pitches[i] > pitches[i - 1],
      `pitch a ${graus[i]}° (${pitches[i]}) tem de ser maior que a ${graus[i - 1]}° ` +
      `(${pitches[i - 1]}) — se empatar, a métrica não está lendo o eixo vertical`);
  }
});

test('PROPRIEDADE 1b (comportamental): o gate vira no limiar DA CONFIG, não num literal', () => {
  // Não afirma QUANTO vale o limiar — afirma que a decisão é coerente com ele.
  // Assim recalibrar é mexer na config, não no teste, e o teste não mente sobre
  // ter medido uma população que ninguém mediu.
  // Duas afirmações separadas, e a distinção importa: que o campo EXISTE na
  // config de produção (leitura do arquivo real), e que o gate HONRA o valor
  // que recebe (comportamental, com um número arbitrário). Nenhuma das duas
  // crava quanto maxPitch deve valer — não temos medição de pitch de mesma
  // pessoa em população real, e cravar agora repetiria o 0,30 da coerência.
  assert.match(textoConfig, /maxPitch\s*:/,
    'js/config.js precisa declarar maxPitch, separado de maxYaw: virar a cabeça e ' +
    'abaixar o queixo são movimentos diferentes e não há razão para compartilhar tolerância');

  const c = cfg();

  let reprovouEm = null, anterior = null;
  for (let g = 0; g <= 80 && reprovouEm === null; g += 2) {
    const r = regras[NOME_POSE](queixoBaixo(g), c);
    if (!r.ok) reprovouEm = { g, pitch: Math.abs(r.pitch) };
    else anterior = { g, pitch: Math.abs(r.pitch) };
  }

  assert.ok(reprovouEm, 'algum ângulo de queixo baixo tem de reprovar — senão o gate não gateia');
  assert.ok(reprovouEm.pitch >= c.maxPitch,
    'reprovou com pitch abaixo do limiar da config: a decisão não está lendo maxPitch');
  assert.ok(anterior && anterior.pitch < c.maxPitch,
    'o último ângulo aceito tinha pitch acima do limiar: o gate está reprovando tarde demais');
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
