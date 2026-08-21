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
const cfg = (over = {}) => ({ maxYaw: 0.30, maxPitch: 0.25, maxInconsistenciaPose: 0.08, ...over });

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

/* O GATE ABSOLUTO DE PITCH FOI CANCELADO — e os testes que o guiavam saíram
daqui, de propósito, em vez de ficarem vermelhos esperando.

Eles existiram e fizeram o trabalho: guiaram até a descoberta de que pitch
absoluto em 2D exige assumir uma razão antropométrica, e que assumir anatomia no
GATE produz viés demográfico (o matcher errado manda para revisão humana; o gate
errado nem tenta). A decisão foi não entrar — não é adiamento, é
não-respondível-sem-viés. Fica a cegueira uniforme, que é o defeito justo.

Manter os três vermelhos aqui seria pior que inútil: guiariam alguém a
implementar exatamente o que foi decidido não construir, e vermelho que fica
vermelho por dias vira ruído atrás do qual a próxima regressão se esconde.
O que substitui está abaixo — o eixo relativo, que responde a pergunta possível.

Sobrevive desta rodada a asserção de yaw, que continua válida e não depende de
nada disto. */

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

/* ═══════════════ Consistência de pose ENTRE as 3 fotos do lote (T-5EC67B)

Substitui o gate absoluto, que não entra: pitch absoluto em 2D exige assumir
anatomia, e assumir anatomia no gate produz viés demográfico não testável.
Diferença entre fotos da MESMA pessoa cancela o deslocamento anatômico
exatamente — foi isso que a medição mostrou (zero exato em duas anatomias
diferentes), e é o que torna este eixo utilizável e o absoluto não.

E note o que isso destrava: esta é a primeira propriedade de pose que a gente
CONSEGUE testar contra viés. As asserções do gate absoluto não conseguiam —
passavam verdes com qualquer fórmula enviesada. Aqui a ausência de viés é uma
asserção, não uma esperança. */

const NOME_LOTE = 'avaliarPoseLote';  // esperado: (landmarksPorFoto[], cfg) -> { inconsistencia, ok }

/** Mesma pessoa com anatomia própria: nariz e queixo em alturas diferentes. */
function pessoaCom({ nariz, queixo }) {
  return graus => {
    const r = graus * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), o = [];
    const p = [];
    p[36] = { x: 100, y: 150, z: 0 };
    p[45] = { x: 200, y: 150, z: 0 };
    p[30] = { x: 150, y: nariz, z: 20 };
    p[8]  = { x: 150, y: queixo, z: 5 };
    for (const i of [36, 45, 30, 8]) {
      o[i] = { x: p[i].x, y: p[i].y * c - p[i].z * s, z: p[i].y * s + p[i].z * c };
    }
    return { positions: o };
  };
}

const ANA = pessoaCom({ nariz: 190, queixo: 255 });
const BRUNO = pessoaCom({ nariz: 175, queixo: 265 });   // anatomia bem diferente

test('avaliarPoseLote existe e recebe o lote inteiro, não uma foto por vez', () => {
  assert.equal(typeof regras[NOME_LOTE], 'function',
    `${NOME_LOTE} precisa existir em js/regras.js. Recebe o LOTE porque a ` +
    'grandeza é uma diferença: uma foto sozinha não tem contra o que ser comparada.');
  const r = regras[NOME_LOTE]([ANA(0), ANA(0), ANA(0)], cfg());
  for (const campo of ['inconsistencia', 'ok']) {
    assert.ok(campo in r, `o retorno precisa ter '${campo}'`);
  }
});

test('ANTI-VIÉS: mesmas poses em anatomias diferentes dão a MESMA leitura', () => {
  // A asserção que o gate absoluto nunca poderia passar. Medido: em pose
  // idêntica, a leitura absoluta difere por fator ~2 entre estas duas
  // anatomias (0,6154 contra 0,2778); a diferença entre fotos cancela isso.
  // Se esta falhar, a fórmula voltou a depender de anatomia e o viés voltou
  // junto — não ajuste o limiar, troque a fórmula.
  const poses = [0, 15, 30];
  const daAna = regras[NOME_LOTE](poses.map(ANA), cfg()).inconsistencia;
  const doBruno = regras[NOME_LOTE](poses.map(BRUNO), cfg()).inconsistencia;

  assert.ok(Math.abs(daAna - doBruno) < 1e-9,
    `mesmas poses tinham de dar a mesma inconsistência: Ana ${daAna}, Bruno ${doBruno}`);
});

test('três fotos na mesma pose têm inconsistência exatamente zero', () => {
  // Zero EXATO, não aproximado: é diferença de uma grandeza contra ela mesma.
  // Vale nas duas anatomias, que é o ponto.
  for (const [nome, pessoa] of [['Ana', ANA], ['Bruno', BRUNO]]) {
    const r = regras[NOME_LOTE]([pessoa(20), pessoa(20), pessoa(20)], cfg());
    assert.equal(r.inconsistencia, 0, `${nome}: mesma pose três vezes não é inconsistência`);
    assert.equal(r.ok, true, `${nome}: lote consistente não pode ser recusado`);
  }
});

test('quanto mais as poses divergem, maior a inconsistência', () => {
  // Monotonicidade, sem número: o caso real do upload é uma das três fotos com
  // a pessoa olhando para baixo, e o que importa é a ordem, não a escala.
  const leituras = [0, 10, 25, 40].map(desvio =>
    regras[NOME_LOTE]([ANA(0), ANA(0), ANA(desvio)], cfg()).inconsistencia);

  for (let i = 1; i < leituras.length; i++) {
    assert.ok(leituras[i] > leituras[i - 1],
      `desvio maior tinha de dar inconsistência maior: ${leituras[i - 1]} -> ${leituras[i]}`);
  }
});

test('o lote é recusado quando a inconsistência passa do limiar DA CONFIG', () => {
  // Mesmo padrão do resto do arquivo: não afirma QUANTO vale o corte, afirma
  // que a decisão é coerente com o que recebeu. Recalibrar é mexer na config.
  assert.match(textoConfig, /maxInconsistenciaPose\s*:/,
    'js/config.js precisa declarar o limiar de inconsistência de pose');

  const c = cfg();
  let recusou = null, ultimoAceito = null;
  for (let d = 0; d <= 80 && recusou === null; d += 2) {
    const r = regras[NOME_LOTE]([ANA(0), ANA(0), ANA(d)], c);
    if (!r.ok) recusou = r.inconsistencia; else ultimoAceito = r.inconsistencia;
  }

  assert.ok(recusou !== null, 'algum desvio tem de recusar — senão a checagem não checa');
  assert.ok(recusou >= c.maxInconsistenciaPose, 'recusou abaixo do limiar recebido');
  assert.ok(ultimoAceito !== null && ultimoAceito < c.maxInconsistenciaPose,
    'aceitou acima do limiar recebido');
});
