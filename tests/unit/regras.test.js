import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tipoDaVez, vereditoPorDistancia, ranquear, precisaRevisao, emCooldown,
  itensParaRemover, itensRecusados, agoraCorrigido, calcularDeriva, cargaValida, euclidiana, dia,
  indicadores, espelho, gestorDeveMarcar,
  presencaPorEquipe, statusPresenca, serieDiaria, pendenciasPorMotivo, LIMIAR_PRESENCA,
  separarAparelhos, normalizarTelefone, telefonesCompartilhados, retidasPorAparelho
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

// T-D00CE0 (§1.6 do contrato): retido sai da fila igual aceito/duplicado —
// o servidor já tem o registro, só não conta como ponto até o RH decidir.
test('retido sai da fila igual aceito e duplicado: o servidor ja tem o registro', () => {
  const res = [
    { id_cliente: '1', status: 'aceito' },
    { id_cliente: '2', status: 'retido' },
    { id_cliente: '3', status: 'rejeitado' }
  ];
  assert.deepEqual(itensParaRemover(res), ['1', '2']);
});

test('itensRecusados: so rejeitado entra, e tambem sai da fila de envio', () => {
  const res = [
    { id_cliente: '1', status: 'aceito' },
    { id_cliente: '2', status: 'duplicado' },
    { id_cliente: '3', status: 'retido' },
    { id_cliente: '4', status: 'rejeitado' }
  ];
  assert.deepEqual(itensRecusados(res), ['4']);
  assert.deepEqual(itensRecusados([]), []);
  assert.deepEqual(itensRecusados(null), []);
});

/* ------------------------------------------------------- retidasPorAparelho */

test('retidasPorAparelho: agrupa por aparelho, conta e acha a faixa de batida', () => {
  const marcacoes = [
    {
      pendente: true, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'd1',
      aparelho_apelido: 'Tablet Norte', aparelho_revogado_em: '2026-08-20T18:00:00Z',
      marcado_em: '2026-08-20T07:02:00Z', recebido_em: '2026-08-21T14:20:00Z'
    },
    {
      pendente: true, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'd1',
      aparelho_apelido: 'Tablet Norte', aparelho_revogado_em: '2026-08-20T18:00:00Z',
      marcado_em: '2026-08-20T17:40:00Z', recebido_em: '2026-08-21T14:19:00Z'
    }
  ];
  const grupos = retidasPorAparelho(marcacoes);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].dispositivo_id, 'd1');
  assert.equal(grupos[0].apelido, 'Tablet Norte');
  assert.equal(grupos[0].total, 2);
  assert.equal(grupos[0].batida_min, '2026-08-20T07:02:00Z');
  assert.equal(grupos[0].batida_max, '2026-08-20T17:40:00Z');
  assert.equal(grupos[0].recebido_max, '2026-08-21T14:20:00Z');
});

test('retidasPorAparelho: ignora pessoa_inativa_no_envio e nao-pendente', () => {
  const grupos = retidasPorAparelho([
    { pendente: true, motivo_codigo: 'pessoa_inativa_no_envio', aparelho_dispositivo_id: 'd1' },
    { pendente: false, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'd1' }
  ]);
  assert.deepEqual(grupos, []);
});

test('retidasPorAparelho: dois aparelhos viram dois grupos, ordenados do maior pro menor', () => {
  const marcacoes = [
    { pendente: true, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'pequeno', marcado_em: 'x' },
    { pendente: true, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'grande', marcado_em: 'x' },
    { pendente: true, motivo_codigo: 'aparelho_revogado', aparelho_dispositivo_id: 'grande', marcado_em: 'x' }
  ];
  const grupos = retidasPorAparelho(marcacoes);
  assert.deepEqual(grupos.map(g => g.dispositivo_id), ['grande', 'pequeno']);
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


/* --------------------------------------- painel desktop do RH */

const HOJE = '2026-08-14';
// e1: 3 esperados (inclui gestor), e2: 1 esperado (p4 inativo nao conta),
// e3: 2 esperados e ninguem marcou hoje -> critico.
const PPESSOAS = [
  { pessoa_id: 'g1', nome: 'Gestor Um', equipe_id: 'e1', papel: 'gestor', ativo: true },
  { pessoa_id: 'a', nome: 'Ana', equipe_id: 'e1', papel: 'colaborador', ativo: true },
  { pessoa_id: 'b', nome: 'Bruno', equipe_id: 'e1', papel: 'colaborador', ativo: true },
  { pessoa_id: 'c', nome: 'Carla', equipe_id: 'e2', papel: 'colaborador', ativo: true },
  { pessoa_id: 'd', nome: 'Dario', equipe_id: 'e2', papel: 'colaborador', ativo: false },
  { pessoa_id: 'e', nome: 'Elza', equipe_id: 'e3', papel: 'colaborador', ativo: true },
  { pessoa_id: 'f', nome: 'Fabio', equipe_id: 'e3', papel: 'colaborador', ativo: true }
];
const PEQUIPES = [
  { equipe_id: 'e1', nome: 'Um' },
  { equipe_id: 'e2', nome: 'Dois' },
  { equipe_id: 'e3', nome: 'Tres' },
  { equipe_id: 'e9', nome: 'Vazia' }   // sem pessoas -> sem card
];
const PMARCS = [
  { pessoa_id: 'g1', equipe_id: 'e1', marcado_dia: HOJE },
  { pessoa_id: 'a', equipe_id: 'e1', marcado_dia: HOJE },
  { pessoa_id: 'a', equipe_id: 'e1', marcado_dia: HOJE },   // dois pontos, uma pessoa
  { pessoa_id: 'c', equipe_id: 'e2', marcado_dia: HOJE },
  { pessoa_id: 'b', equipe_id: 'e1', marcado_dia: '2026-08-13' }  // ontem nao conta
];

test('presencaPorEquipe conta pessoa unica, gestor incluso, ausente por nao marcar', () => {
  const cards = presencaPorEquipe(PPESSOAS, PMARCS, PEQUIPES, HOJE);
  const e1 = cards.find(c => c.equipe_id === 'e1');
  assert.equal(e1.esperados, 3);              // gestor + Ana + Bruno
  assert.equal(e1.presentes, 2);              // gestor e Ana; Bruno so marcou ontem
  assert.deepEqual(e1.ausentes, ['Bruno']);
});

test('presencaPorEquipe: pessoa inativa fica fora da conta', () => {
  const cards = presencaPorEquipe(PPESSOAS, PMARCS, PEQUIPES, HOJE);
  const e2 = cards.find(c => c.equipe_id === 'e2');
  assert.equal(e2.esperados, 1);              // Dario inativo nao entra
  assert.equal(e2.presenca, 1);
  assert.equal(e2.status, 'bom');
});

test('presencaPorEquipe: equipe sem marcacao hoje e critica, nao sem-dado', () => {
  const cards = presencaPorEquipe(PPESSOAS, PMARCS, PEQUIPES, HOJE);
  const e3 = cards.find(c => c.equipe_id === 'e3');
  assert.equal(e3.presenca, 0);
  assert.equal(e3.status, 'critico');
});

test('presencaPorEquipe: equipe sem esperados nao vira card', () => {
  const cards = presencaPorEquipe(PPESSOAS, PMARCS, PEQUIPES, HOJE);
  assert.equal(cards.some(c => c.equipe_id === 'e9'), false);
});

test('presencaPorEquipe ordena do pior para o melhor', () => {
  const cards = presencaPorEquipe(PPESSOAS, PMARCS, PEQUIPES, HOJE);
  assert.deepEqual(cards.map(c => c.equipe_id), ['e3', 'e1', 'e2']);
});

test('statusPresenca acerta exatamente nos limiares', () => {
  assert.equal(statusPresenca(0.95, LIMIAR_PRESENCA), 'bom');
  assert.equal(statusPresenca(0.9499, LIMIAR_PRESENCA), 'atencao');
  assert.equal(statusPresenca(0.85, LIMIAR_PRESENCA), 'atencao');
  assert.equal(statusPresenca(0.8499, LIMIAR_PRESENCA), 'serio');
  assert.equal(statusPresenca(0.70, LIMIAR_PRESENCA), 'serio');
  assert.equal(statusPresenca(0.6999, LIMIAR_PRESENCA), 'critico');
  assert.equal(statusPresenca(1, LIMIAR_PRESENCA), 'bom');
  assert.equal(statusPresenca(0, LIMIAR_PRESENCA), 'critico');
});

test('serieDiaria preenche dias sem marcacao com zero', () => {
  const s = serieDiaria([
    { marcado_dia: '2026-08-14', origem: 'biometria' },
    { marcado_dia: '2026-08-14', origem: 'manual' },
    { marcado_dia: '2026-08-12', origem: 'biometria' }
  ], 3, HOJE);
  assert.deepEqual(s.dias, ['2026-08-12', '2026-08-13', '2026-08-14']);
  assert.deepEqual(s.total, [1, 0, 2]);        // 13 fica zero, nao some
  assert.deepEqual(s.biometria, [1, 0, 1]);
  assert.deepEqual(s.manual, [0, 0, 1]);
});

test('serieDiaria ignora marcacao fora do periodo', () => {
  const s = serieDiaria([{ marcado_dia: '2026-07-01', origem: 'biometria' }], 3, HOJE);
  assert.deepEqual(s.total, [0, 0, 0]);
});

test('pendenciasPorMotivo conta uma marcacao em dois motivos ao mesmo tempo', () => {
  const pessoas = [{ pessoa_id: 'x', papel: 'colaborador' }];
  const marcs = [
    // manual E relogio fora: conta nas duas barras
    { pessoa_id: 'x', pendente: true, origem: 'manual', veredito: 'manual', deriva_relogio_ms: 200000 }
  ];
  const r = pendenciasPorMotivo(marcs, [], pessoas);
  const por = Object.fromEntries(r.map(x => [x.chave, x.total]));
  assert.equal(por.manual, 1);
  assert.equal(por.relogio, 1);
  assert.equal(por.cinza, 0);
});

test('pendenciasPorMotivo soma recadastros e ignora nao-pendentes', () => {
  const pessoas = [{ pessoa_id: 'g', papel: 'gestor' }];
  const marcs = [
    { pessoa_id: 'g', pendente: true, veredito: 'aceito', origem: 'biometria' },
    { pessoa_id: 'g', pendente: false, veredito: 'revisar', origem: 'manual' }  // nao pendente: ignora
  ];
  const r = pendenciasPorMotivo(marcs, [{ template_id: 't1' }], pessoas);
  const por = Object.fromEntries(r.map(x => [x.chave, x.total]));
  assert.equal(por.gestor, 1);
  assert.equal(por.manual, 0);
  assert.equal(por.recadastro, 1);
});

/* ---------------------------------------------------- separarAparelhos */

test('separarAparelhos: so pendente e ativo entram, negado e revogado ficam de fora', () => {
  const { pendentes, aprovados } = separarAparelhos([
    { dispositivo_id: 'd-pendente', estado: 'pendente', criado_em: '2026-08-10T00:00:00Z' },
    { dispositivo_id: 'd-ativo', estado: 'ativo', ultimo_uso: '2026-08-19T00:00:00Z' },
    { dispositivo_id: 'd-negado', estado: 'negado' },
    { dispositivo_id: 'd-revogado', estado: 'revogado' }
  ]);
  assert.deepEqual(pendentes.map(d => d.dispositivo_id), ['d-pendente']);
  assert.deepEqual(aprovados.map(d => d.dispositivo_id), ['d-ativo']);
});

test('separarAparelhos: pendentes na ordem de quem espera ha mais tempo', () => {
  const { pendentes } = separarAparelhos([
    { dispositivo_id: 'novo', estado: 'pendente', criado_em: '2026-08-19T10:00:00Z' },
    { dispositivo_id: 'antigo', estado: 'pendente', criado_em: '2026-08-15T10:00:00Z' }
  ]);
  assert.deepEqual(pendentes.map(d => d.dispositivo_id), ['antigo', 'novo']);
});

test('separarAparelhos: aprovados por uso mais recente primeiro, nunca-usado vai pro fim', () => {
  const { aprovados } = separarAparelhos([
    { dispositivo_id: 'usado-ha-pouco', estado: 'ativo', ultimo_uso: '2026-08-19T10:00:00Z' },
    { dispositivo_id: 'nunca-usado', estado: 'ativo', ultimo_uso: null },
    { dispositivo_id: 'usado-faz-tempo', estado: 'ativo', ultimo_uso: '2026-08-01T10:00:00Z' }
  ]);
  assert.deepEqual(aprovados.map(d => d.dispositivo_id), ['usado-ha-pouco', 'usado-faz-tempo', 'nunca-usado']);
});

test('separarAparelhos: lista vazia ou ausente nao explode', () => {
  assert.deepEqual(separarAparelhos([]), { pendentes: [], aprovados: [] });
  assert.deepEqual(separarAparelhos(undefined), { pendentes: [], aprovados: [] });
});

/* ------------------------------------------------------- normalizarTelefone */

test('normalizarTelefone: 11 digitos BR vira +55 e-164', () => {
  const r = normalizarTelefone('67998765432');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+5567998765432');
  assert.equal(r.estrangeiro, false);
});

test('normalizarTelefone: mascara bonita normaliza igual ao digitos puros', () => {
  const r = normalizarTelefone('(67) 99876-5432');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+5567998765432');
});

test('normalizarTelefone: 13 digitos comecando em 55 e o mesmo numero', () => {
  const r = normalizarTelefone('5567998765432');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+5567998765432');
});

test('normalizarTelefone: com + na frente tambem aceita BR', () => {
  const r = normalizarTelefone('+5567998765432');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+5567998765432');
});

test('normalizarTelefone: fixo de 10 digitos e TELEFONE_NAO_MOVEL', () => {
  const r = normalizarTelefone('6733224455');
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'TELEFONE_NAO_MOVEL');
});

test('normalizarTelefone: fixo de 12 digitos comecando em 55 tambem e TELEFONE_NAO_MOVEL', () => {
  const r = normalizarTelefone('556733224455');
  assert.equal(r.codigo, 'TELEFONE_NAO_MOVEL');
});

test('normalizarTelefone: celular BR sem o 9 na frente do numero e nao-movel', () => {
  const r = normalizarTelefone('67888765432'); // DDD 67 + 8 (sem 9) + 8 digitos
  assert.equal(r.codigo, 'TELEFONE_NAO_MOVEL');
});

test('normalizarTelefone: ausente ou vazio e TELEFONE_OBRIGATORIO', () => {
  assert.equal(normalizarTelefone('').codigo, 'TELEFONE_OBRIGATORIO');
  assert.equal(normalizarTelefone(null).codigo, 'TELEFONE_OBRIGATORIO');
  assert.equal(normalizarTelefone(undefined).codigo, 'TELEFONE_OBRIGATORIO');
});

test('normalizarTelefone: DDD com zero ou fora de 11-99 e TELEFONE_INVALIDO', () => {
  assert.equal(normalizarTelefone('07998765432').codigo, 'TELEFONE_INVALIDO');   // ddd 07
  assert.equal(normalizarTelefone('10998765432').codigo, 'TELEFONE_INVALIDO');   // ddd 10, fora de 11-99
});

test('normalizarTelefone: tamanho estranho ou letra sobrando e TELEFONE_INVALIDO', () => {
  assert.equal(normalizarTelefone('123').codigo, 'TELEFONE_INVALIDO');
  assert.equal(normalizarTelefone('6799876543299999').codigo, 'TELEFONE_INVALIDO');
  assert.equal(normalizarTelefone('6799876abc2').codigo, 'TELEFONE_INVALIDO');
});

test('normalizarTelefone: numero estrangeiro com + e pais diferente de 55 e aceito e marcado', () => {
  const r = normalizarTelefone('+12025551234');
  assert.equal(r.ok, true);
  assert.equal(r.e164, '+12025551234');
  assert.equal(r.estrangeiro, true);
});

test('normalizarTelefone: estrangeiro fora de 8-15 digitos e TELEFONE_INVALIDO', () => {
  assert.equal(normalizarTelefone('+1234').codigo, 'TELEFONE_INVALIDO');
});

/* --------------------------------------------------- telefonesCompartilhados */

test('telefonesCompartilhados: duas pessoas ativas com o mesmo numero se apontam', () => {
  const mapa = telefonesCompartilhados([
    { pessoa_id: 'p1', nome: 'Ana', ativo: true, telefone: '+5567998765432' },
    { pessoa_id: 'p2', nome: 'Bruno', ativo: true, telefone: '+5567998765432' },
    { pessoa_id: 'p3', nome: 'Carla', ativo: true, telefone: '+5567911112222' }
  ]);
  assert.deepEqual(mapa.p1, [{ pessoa_id: 'p2', nome: 'Bruno' }]);
  assert.deepEqual(mapa.p2, [{ pessoa_id: 'p1', nome: 'Ana' }]);
  assert.equal(mapa.p3, undefined);
});

test('telefonesCompartilhados: pessoa inativa nao conta pro compartilhamento', () => {
  const mapa = telefonesCompartilhados([
    { pessoa_id: 'p1', nome: 'Ana', ativo: true, telefone: '+5567998765432' },
    { pessoa_id: 'p2', nome: 'Bruno', ativo: false, telefone: '+5567998765432' }
  ]);
  assert.equal(mapa.p1, undefined);
  assert.equal(mapa.p2, undefined);
});

test('telefonesCompartilhados: tres pessoas no mesmo numero aparecem uma pras outras duas', () => {
  const mapa = telefonesCompartilhados([
    { pessoa_id: 'p1', nome: 'Ana', ativo: true, telefone: '+5567998765432' },
    { pessoa_id: 'p2', nome: 'Bruno', ativo: true, telefone: '+5567998765432' },
    { pessoa_id: 'p3', nome: 'Carla', ativo: true, telefone: '+5567998765432' }
  ]);
  assert.equal(mapa.p1.length, 2);
  assert.equal(mapa.p2.length, 2);
  assert.equal(mapa.p3.length, 2);
});

test('telefonesCompartilhados: pessoa sem telefone nunca entra no mapa', () => {
  const mapa = telefonesCompartilhados([
    { pessoa_id: 'p1', nome: 'Ana', ativo: true, telefone: '' },
    { pessoa_id: 'p2', nome: 'Bruno', ativo: true, telefone: '' }
  ]);
  assert.deepEqual(mapa, {});
});
