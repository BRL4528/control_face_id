import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, precisaRevisao, emCooldown,
  itensParaRemover, agoraCorrigido, calcularDeriva, cargaValida, euclidiana, dia
} from '../../js/regras.js';

const CFG = { limiarAceite: 0.45, limiarCinza: 0.58 };

test('tipoDaVez alterna entrada e saida', () => {
  assert.equal(tipoDaVez([]), 'entrada');
  assert.equal(tipoDaVez([{ tipo: 'entrada' }]), 'saida');
  assert.equal(tipoDaVez([{ tipo: 'entrada' }, { tipo: 'saida' }]), 'entrada');
  assert.equal(tipoDaVez(null), 'entrada');
});

test('tipoDaVez ignora registros sem tipo', () => {
  assert.equal(tipoDaVez([{ tipo: 'entrada' }, {}, null]), 'saida');
});

test('vereditoPorDistancia respeita as tres faixas', () => {
  assert.equal(vereditoPorDistancia(0.10, CFG), 'aceito');
  assert.equal(vereditoPorDistancia(0.45, CFG), 'aceito');
  assert.equal(vereditoPorDistancia(0.50, CFG), 'revisar');
  assert.equal(vereditoPorDistancia(0.58, CFG), 'revisar');
  assert.equal(vereditoPorDistancia(0.59, CFG), 'rejeitado');
});

test('distancia invalida nunca vira aceite silencioso', () => {
  assert.equal(vereditoPorDistancia(null, CFG), 'revisar');
  assert.equal(vereditoPorDistancia(NaN, CFG), 'revisar');
  assert.equal(vereditoPorDistancia(undefined, CFG), 'revisar');
});

test('ranquear escolhe o menor entre os templates da pessoa', () => {
  const galeria = [
    { pessoa_id: 'a', vetores: [[0, 0], [10, 10]] },
    { pessoa_id: 'b', vetores: [[3, 4]] }
  ];
  const r = ranquear([0, 0], galeria, euclidiana);
  assert.equal(r.melhor.pessoa.pessoa_id, 'a');
  assert.equal(r.melhor.dist, 0);
  assert.equal(r.margem, 5);
});

test('ranquear ignora pessoa sem template', () => {
  const r = ranquear([0, 0], [{ pessoa_id: 'a' }, { pessoa_id: 'b', vetores: [] }], euclidiana);
  assert.equal(r.melhor, null);
  assert.equal(r.margem, null);
});

test('precisaRevisao cobre os quatro gatilhos', () => {
  const base = { veredito: 'aceito', origem: 'biometria', deriva_relogio_ms: 0 };
  assert.equal(precisaRevisao(base, 'colaborador', CFG), false);
  assert.equal(precisaRevisao({ ...base, veredito: 'revisar' }, 'colaborador', CFG), true);
  assert.equal(precisaRevisao({ ...base, origem: 'manual' }, 'colaborador', CFG), true);
  assert.equal(precisaRevisao(base, 'gestor', CFG), true);
  assert.equal(precisaRevisao({ ...base, deriva_relogio_ms: 130000 }, 'colaborador', CFG), true);
  assert.equal(precisaRevisao({ ...base, deriva_relogio_ms: -130000 }, 'colaborador', CFG), true);
});

test('cooldown impede marcacao repetida da mesma pessoa', () => {
  const agora = Date.parse('2026-08-14T09:00:00Z');
  const doDia = [{ pessoa_id: 'a', marcado_em: '2026-08-14T08:59:30Z' }];
  assert.equal(emCooldown('a', doDia, agora, 60000), true);
  assert.equal(emCooldown('b', doDia, agora, 60000), false);
  assert.equal(emCooldown('a', doDia, agora, 10000), false);
});

test('so sai da fila o que o servidor confirmou', () => {
  const res = [
    { id_cliente: '1', status: 'aceito' },
    { id_cliente: '2', status: 'duplicado' },
    { id_cliente: '3', status: 'rejeitado' }
  ];
  assert.deepEqual(itensParaRemover(res), ['1', '2']);
  assert.deepEqual(itensParaRemover([]), []);
  assert.deepEqual(itensParaRemover(null), []);
});

test('duplicado sai da fila: servidor ja tem o registro', () => {
  assert.deepEqual(itensParaRemover([{ id_cliente: 'x', status: 'duplicado' }]), ['x']);
});

test('calcularDeriva desconta metade da ida e volta', () => {
  // aparelho 5s adiantado, resposta levou 200ms
  const t0 = 1000000, t1 = 1000200;
  const servidor = new Date(t0 + 100 - 5000).toISOString();
  assert.equal(calcularDeriva(t0, t1, servidor), 5000);
});

test('latencia sozinha nao vira relogio errado', () => {
  const t0 = 1000000, t1 = 1002000;           // 2s de ida e volta
  const servidor = new Date(t0 + 1000).toISOString();
  assert.equal(Math.abs(calcularDeriva(t0, t1, servidor)), 0);
});

test('deriva com hora invalida devolve zero em vez de NaN', () => {
  assert.equal(calcularDeriva(1000, 1100, 'nao-e-data'), 0);
});

test('agoraCorrigido aplica a deriva', () => {
  assert.equal(agoraCorrigido(5000, 1000000).getTime(), 995000);
  assert.equal(agoraCorrigido(null, 1000000).getTime(), 1000000);
});

test('cargaValida expira no fim do dia', () => {
  const carga = { expira_em: '2026-08-14T23:59:59Z' };
  assert.equal(cargaValida(carga, Date.parse('2026-08-14T18:00:00Z')), true);
  assert.equal(cargaValida(carga, Date.parse('2026-08-15T06:00:00Z')), false);
  assert.equal(cargaValida(null, Date.now()), false);
  assert.equal(cargaValida({}, Date.now()), false);
});

test('euclidiana', () => {
  assert.equal(euclidiana([0, 0], [3, 4]), 5);
  assert.equal(euclidiana([1, 2, 3], [1, 2, 3]), 0);
});

test('dia extrai a data do ISO', () => {
  assert.equal(dia('2026-08-14T09:03:11.000Z'), '2026-08-14');
});
