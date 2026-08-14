import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, precisaRevisao, emCooldown,
  itensParaRemover, agoraCorrigido, calcularDeriva, cargaValida, euclidiana, dia,
  indicadores, espelho, gestorDeveMarcar
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


/* --------------------------------------------------- painel do RH */

const PESSOAS = [
  { pessoa_id: 'p1', equipe_id: 'e1', ativo: true, tem_biometria: true },
  { pessoa_id: 'p2', equipe_id: 'e1', ativo: true, tem_biometria: false },
  { pessoa_id: 'p3', equipe_id: 'e2', ativo: true, tem_biometria: true },
  { pessoa_id: 'p4', equipe_id: 'e2', ativo: false, tem_biometria: true }
];
const EQUIPES = [{ equipe_id: 'e1', nome: 'Um' }, { equipe_id: 'e2', nome: 'Dois' }];
const MARCS = [
  { equipe_id: 'e1', pessoa_id: 'p1', origem: 'biometria', veredito: 'aceito', pendente: false, marcado_dia: '2026-08-14', marcado_em: '2026-08-14T09:00:00.000Z' },
  { equipe_id: 'e1', pessoa_id: 'p1', origem: 'manual', veredito: 'manual', pendente: true, marcado_dia: '2026-08-14', marcado_em: '2026-08-14T18:00:00.000Z' },
  { equipe_id: 'e2', pessoa_id: 'p3', origem: 'biometria', veredito: 'revisar', pendente: true, marcado_dia: '2026-08-13', marcado_em: '2026-08-13T08:00:00.000Z' }
];

test('indicadores somam total, manuais, cinzentas e pendentes', () => {
  const i = indicadores(MARCS, PESSOAS, EQUIPES);
  assert.equal(i.total, 3);
  assert.equal(i.manuais, 1);
  assert.equal(i.cinzentas, 1);
  assert.equal(i.pendentes, 2);
  assert.equal(i.semBiometria, 1);          // p4 esta inativo e nao conta
  assert.equal(i.taxaManual, 33.3);
});

test('indicadores ranqueiam a equipe com mais registro manual primeiro', () => {
  const i = indicadores(MARCS, PESSOAS, EQUIPES);
  assert.equal(i.equipes[0].equipe_id, 'e1');
  assert.equal(i.equipes[0].taxa_manual, 50);
  assert.equal(i.equipes[0].pessoas, 2);
  assert.equal(i.equipes[1].taxa_manual, 0);
});

test('indicadores ignoram marcacao de equipe desconhecida sem quebrar', () => {
  const i = indicadores([{ equipe_id: 'fantasma', origem: 'manual' }], PESSOAS, EQUIPES);
  assert.equal(i.total, 1);
  assert.equal(i.equipes.every(e => e.marcacoes === 0), true);
});

test('indicadores com tudo vazio nao dividem por zero', () => {
  const i = indicadores([], [], []);
  assert.equal(i.taxaManual, 0);
  assert.deepEqual(i.equipes, []);
});

test('espelho agrupa por dia, mais recente primeiro, e ordena dentro do dia', () => {
  const e = espelho(MARCS, 'p1');
  assert.equal(e.length, 1);
  assert.equal(e[0].dia, '2026-08-14');
  assert.equal(e[0].marcacoes.length, 2);
  assert.equal(e[0].marcacoes[0].marcado_em, '2026-08-14T09:00:00.000Z');
});

test('espelho so traz a pessoa pedida', () => {
  assert.equal(espelho(MARCS, 'p3').length, 1);
  assert.deepEqual(espelho(MARCS, 'ninguem'), []);
  assert.deepEqual(espelho(null, 'p1'), []);
});

test('gestorDeveMarcar: primeira abertura do dia sempre marca', () => {
  assert.equal(gestorDeveMarcar([], Date.now(), 90000), true);
  assert.equal(gestorDeveMarcar(null, Date.now(), 90000), true);
});

test('gestorDeveMarcar: reabrir dentro do cooldown nao remarca', () => {
  const agora = Date.parse('2026-08-14T09:00:30.000Z');
  const ms = [{ marcado_em: '2026-08-14T09:00:00.000Z' }];
  assert.equal(gestorDeveMarcar(ms, agora, 90000), false);
});

test('gestorDeveMarcar: passado o cooldown a saida do gestor e registrada', () => {
  const agora = Date.parse('2026-08-14T18:00:00.000Z');
  const ms = [
    { marcado_em: '2026-08-14T09:00:00.000Z' },
    { marcado_em: '2026-08-14T12:00:00.000Z' }
  ];
  assert.equal(gestorDeveMarcar(ms, agora, 90000), true);
});

test('gestorDeveMarcar olha a marcacao mais recente, nao a primeira da lista', () => {
  const agora = Date.parse('2026-08-14T12:00:10.000Z');
  const ms = [
    { marcado_em: '2026-08-14T12:00:00.000Z' },
    { marcado_em: '2026-08-14T09:00:00.000Z' }
  ];
  assert.equal(gestorDeveMarcar(ms, agora, 90000), false);
});
