import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { avaliarLoteFace, DIMENSAO_DESCRITOR, PISO_MESMO_ARQUIVO } from '../../js/coerencia.js';
import {
  loteMesmaPessoa, loteDuasPessoas, loteDuasPessoasDistante,
  loteComMaiorDistancia, maiorDistanciaParAPar
} from '../e2e/fixtures-biometria.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIMIAR = 0.45; // cfg.limiarAceite (js/config.js) — mesma fonte do reconhecimento

test('limiar tem fonte única: EFRAT_CFG.limiarAceite (cliente) e o limiar do servidor de teste valem o mesmo número (docs/fase3-contrato.md § 4.2, item 14)', () => {
  const cfg = fs.readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8');
  const doCliente = cfg.match(/limiarAceite:\s*([\d.]+)/);
  assert.ok(doCliente, 'js/config.js precisa definir limiarAceite');

  const servidorFalso = fs.readFileSync(path.join(RAIZ, 'tests/e2e/servidor-falso.js'), 'utf8');
  const doServidor = servidorFalso.match(/limiarAceiteCadastro\s*=\s*opts\.limiarAceite\s*!=\s*null\s*\?\s*opts\.limiarAceite\s*:\s*([\d.]+)/);
  assert.ok(doServidor, 'tests/e2e/servidor-falso.js precisa de um limiar padrão explícito para /efrat/cadastro');

  assert.equal(Number(doCliente[1]), Number(doServidor[1]),
    'EFRAT_CFG.limiarAceite e o limiar de /efrat/cadastro divergiram — é exatamente o tipo de divergência silenciosa que este teste existe para pegar');
});

test('lote de 3 fotos com duas pessoas diferentes é recusado (README.md:129 — par 0,61)', () => {
  const vetores = loteDuasPessoas();
  assert.ok(maiorDistanciaParAPar(vetores) > LIMIAR);
  const r = avaliarLoteFace(vetores, LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'COERENCIA_INSUFICIENTE');
});

test('o outro par medido de pessoas diferentes (README.md:129 — 0,80) também é recusado', () => {
  const vetores = loteDuasPessoasDistante();
  assert.ok(maiorDistanciaParAPar(vetores) > LIMIAR);
  const r = avaliarLoteFace(vetores, LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'COERENCIA_INSUFICIENTE');
});

test('contraprova — três capturas da mesma pessoa gravam normalmente', () => {
  const vetores = loteMesmaPessoa();
  assert.ok(maiorDistanciaParAPar(vetores) < LIMIAR);
  const r = avaliarLoteFace(vetores, LIMIAR);
  assert.equal(r.ok, true);
});

test('veredito vira em torno do limiar de aceite: 0,4601 recusa, 0,4401 grava', () => {
  assert.equal(avaliarLoteFace(loteComMaiorDistancia(0.46), LIMIAR).ok, false);
  assert.equal(avaliarLoteFace(loteComMaiorDistancia(0.44), LIMIAR).ok, true);
});

test('em exatamente o limiar o cadastro recusa (>=, não <=) — assimetria intencional com vereditoPorDistancia', () => {
  const a = new Array(DIMENSAO_DESCRITOR).fill(0);
  const b = a.slice(); b[0] = LIMIAR;
  const c = a.slice(); c[1] = 0.03; // acima do piso de mesmo-arquivo, sem afetar a maior distância
  assert.equal(avaliarLoteFace([a, b, c], LIMIAR).ok, false);
});

test('limiar vem de fora — não é constante paralela dentro da função (§ 4.2c)', () => {
  const lote = loteDuasPessoas();
  assert.equal(avaliarLoteFace(lote, 0.1).ok, false);
  assert.equal(avaliarLoteFace(lote, 5).ok, true); // mesmo lote, limiar mais frouxo, veredito muda
});

test('as 3 capturas sendo o mesmo arquivo (ou quase) é recusado como FOTOS_IGUAIS, não aceito como "muito coerente"', () => {
  const a = new Array(DIMENSAO_DESCRITOR).fill(0.5);
  const b = a.slice(); b[0] += PISO_MESMO_ARQUIVO / 2;
  const r = avaliarLoteFace([a, b, a.slice()], LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'FOTOS_IGUAIS');
});

test('FOTOS_IGUAIS é sobre a MAIOR distância (todas quase idênticas), não sobre um par coincidir', () => {
  // Duas capturas quase idênticas + uma genuinamente diferente (pose real):
  // não é "mesmo arquivo 3x", é coerência normal — não pode cair em FOTOS_IGUAIS.
  const vetores = loteMesmaPessoa();
  const quaseIgual = vetores[0].slice(); quaseIgual[5] += 0.001;
  const r = avaliarLoteFace([vetores[0], quaseIgual, vetores[2]], LIMIAR);
  assert.equal(r.ok, true);
});

test('menos de 3 vetores é recusado, não "usa os que tem"', () => {
  const tres = loteMesmaPessoa();
  const r = avaliarLoteFace(tres.slice(0, 2), LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'VETORES_INVALIDOS');
});

test('mais de 3 vetores é recusado, não "usa os 3 primeiros"', () => {
  const tres = loteMesmaPessoa();
  const r = avaliarLoteFace([...tres, tres[0]], LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'VETORES_INVALIDOS');
});

test('descritor com 127 posições é recusado', () => {
  const tres = loteMesmaPessoa();
  const curto = tres.slice(); curto[2] = curto[2].slice(0, 127);
  const r = avaliarLoteFace(curto, LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'VETORES_INVALIDOS');
});

test('descritor com NaN é recusado', () => {
  const tres = loteMesmaPessoa().map(v => v.slice());
  tres[1][0] = NaN;
  const r = avaliarLoteFace(tres, LIMIAR);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'VETORES_INVALIDOS');
});

test('entrada que não é array de vetores é recusada', () => {
  assert.equal(avaliarLoteFace(null, LIMIAR).ok, false);
  assert.equal(avaliarLoteFace(undefined, LIMIAR).ok, false);
  assert.equal(avaliarLoteFace('não é lote', LIMIAR).ok, false);
});
