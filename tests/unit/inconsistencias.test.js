import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inconsistencias, linhasCsv, htmlRelatorio } from '../../js/inconsistencias.js';

const FUSO = 'America/Campo_Grande';   // UTC-4
const pessoas = [
  { pessoa_id: 'p1', nome: 'ANA', equipe_id: 'e574' }, { pessoa_id: 'p2', nome: 'BRUNO', equipe_id: 'e574' },
  { pessoa_id: 'p3', nome: 'CAIO', equipe_id: 'e471' }, { pessoa_id: 'p4', nome: 'DIANA', equipe_id: 'e471' }
];
const equipes = [{ equipe_id: 'e574', nome: 'Obra 574', local_id: 'l574' }, { equipe_id: 'e471', nome: 'Obra 471', local_id: 'l471' }];
const locais = [{ local_id: 'l574', lat: -18.916, lng: -54.853 }, { local_id: 'l471', lat: -20.387, lng: -54.578 }];
// hh:mm locais (UTC-4) → ISO UTC
const em = (dia, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10), h + 4, m)).toISOString(); };
let seq = 0;
const marc = (pessoa_id, dia, hm, tipo, extra) => Object.assign({
  id_cliente: 'm' + (++seq), pessoa_id, equipe_id: pessoas.find(p => p.pessoa_id === pessoa_id).equipe_id, tipo, origem: 'biometria',
  marcado_em: em(dia, hm), marcado_dia: dia, estado: 'aceita', lat: -20.387, lng: -54.578, dentro_cerca: true, distancia_cerca_m: 10,
  score: 0.3, liveness_ok: true
}, extra || {});
const chaves = gs => gs.map(g => g.chave);
const base = { pessoas, equipes, locais, hoje: '2026-10-31', fuso: FUSO, cfg: { limiarAceite: 0.45 } };

test('turma batendo sempre no mesmo lugar longe da cerca vira um grupo só, com quem é de outra equipe', () => {
  const longe = { dentro_cerca: false, lat: -23.869, lng: -54.327, distancia_cerca_m: 553000, estado: 'pendente' };
  const ms = [];
  for (const d of ['2026-10-29', '2026-10-30', '2026-10-31']) for (const p of ['p1', 'p2']) ms.push(marc(p, d, '07:00', 'entrada', longe));
  // outro canteiro a ~7 km e alguém da 471 trabalhando junto: mesmo grupo
  ms.push(marc('p4', '2026-10-30', '07:00', 'entrada', Object.assign({}, longe, { lat: -23.921, lng: -54.286 })));
  ms.push(marc('p3', '2026-10-30', '07:00', 'entrada', { dentro_cerca: false, lat: -20.40, lng: -54.56, distancia_cerca_m: 2138, estado: 'pendente' }));
  const gs = inconsistencias({ ...base, marcacoes: ms });
  const c = gs.find(g => g.chave === 'cerca_errada');
  assert.ok(c, 'agrupa a obra 574');
  assert.equal(c.equipe_id, 'e574');
  assert.equal(gs.filter(g => g.chave === 'cerca_errada').length, 1);
  assert.deepEqual(c.itens.map(i => i.pessoa), ['ANA', 'BRUNO', 'DIANA']);
  assert.match(c.explicacao, /7 vezes em 3 dias/);
  assert.match(c.explicacao, /Junto, gente de Obra 471/);
  const isolada = gs.find(g => g.chave === 'fora_cerca');
  assert.equal(isolada.itens.length, 1, 'só a batida do CAIO fica avulsa');
  assert.equal(isolada.itens[0].pessoa, 'CAIO');
});

test('cadastro fraco (3+ na zona cinzenta), sem GPS, madrugada e pendência parada', () => {
  const ms = [
    ...['2026-10-27', '2026-10-28', '2026-10-29'].map(d => marc('p3', d, '07:00', 'entrada', { score: 0.52 })),
    marc('p4', '2026-10-30', '07:00', 'entrada', { lat: null, lng: null, dentro_cerca: null, estado: 'pendente' }),
    marc('p4', '2026-10-30', '23:22', 'saida'),
    marc('p1', '2026-10-20', '07:00', 'entrada', { estado: 'pendente' })
  ];
  const gs = inconsistencias({ ...base, marcacoes: ms });
  assert.equal(gs.find(g => g.chave === 'cadastro_fraco').itens[0].pessoa, 'CAIO');
  assert.match(gs.find(g => g.chave === 'cadastro_fraco').itens[0].detalhe, /0,52/);
  assert.equal(gs.find(g => g.chave === 'sem_gps').itens[0].pessoa, 'DIANA');
  assert.equal(gs.find(g => g.chave === 'madrugada').itens[0].detalhe, '23:22');
  assert.equal(gs.find(g => g.chave === 'pendencia_antiga').itens[0].pessoa, 'ANA');
  assert.equal(gs[0].severidade, 'alta', 'mais grave primeiro');
});

test('CLT: intervalo < 1 h, descanso < 11 h, extra > 2 h e jornada > 10 h', () => {
  const ms = [
    marc('p3', '2026-10-29', '07:00', 'entrada'), marc('p3', '2026-10-29', '11:00', 'saida'),
    marc('p3', '2026-10-29', '11:30', 'entrada'), marc('p3', '2026-10-29', '22:00', 'saida'),
    marc('p3', '2026-10-30', '06:00', 'entrada'), marc('p3', '2026-10-30', '12:00', 'saida')
  ];
  const linhas = [{ pessoa_id: 'p3', nome: 'CAIO', totais: { dias: 2 }, dias: [
    { dia: '2026-10-29', equipe_id: 'e471', status: 'ok', saldo: 210, trabalhado: 870, marcacoes: 4 },
    { dia: '2026-10-30', equipe_id: 'e471', status: 'ok', saldo: 0, trabalhado: 360, marcacoes: 2 }
  ] }];
  const gs = inconsistencias({ ...base, marcacoes: ms, linhas });
  assert.match(gs.find(g => g.chave === 'clt_intervalo').itens[0].detalhe, /30 min/);
  assert.match(gs.find(g => g.chave === 'clt_interjornada').itens[0].detalhe, /^8h00 de descanso/);
  assert.equal(gs.find(g => g.chave === 'clt_extra').itens[0].detalhe, '3h30 de hora extra');
  assert.ok(gs.find(g => g.chave === 'clt_10h'));
});

test('pelo relatório de horas: sem batida nenhuma, faltas e dia incompleto', () => {
  const falta = d => ({ dia: d, status: 'falta', equipe_id: 'e471', trabalhado: 0, marcacoes: 0 });
  const linhas = [
    { pessoa_id: 'p3', nome: 'CAIO', totais: { dias: 0 }, dias: ['2026-10-27', '2026-10-28', '2026-10-29'].map(falta) },
    { pessoa_id: 'p4', nome: 'DIANA', totais: { dias: 3 }, dias: [falta('2026-10-27'),
      { dia: '2026-10-28', status: 'incompleto', equipe_id: 'e471', trabalhado: 0, marcacoes: 1 }] }
  ];
  const gs = inconsistencias({ ...base, linhas });
  assert.equal(gs.find(g => g.chave === 'sem_batida').itens[0].pessoa, 'CAIO');
  assert.match(gs.find(g => g.chave === 'faltas').itens[0].detalhe, /^1 falta: 27\/10/);
  assert.equal(gs.find(g => g.chave === 'incompleto').itens[0].dia, '2026-10-28');
  assert.ok(!chaves(gs).includes('cerca_errada'));
});

test('aparelho novo com sugestão pelo rosto e avisos do Bitrix', () => {
  const gs = inconsistencias({ ...base,
    aparelhos: [{ pareado_em: '2026-10-30T11:00:00Z', sugestoes: [{ colaborador_id: 'p3', distancia: 0.338 }], marcacoes: [{}, {}] }],
    avisosBitrix: [{ tipo: 'card_sem_contato', card: 7819, titulo: 'EDIVALDO' }] });
  const ap = gs.find(g => g.chave === 'aparelho').itens[0];
  assert.equal(ap.pessoa, 'Parece ser CAIO');
  assert.match(ap.detalhe, /2 batidas · distância do rosto 0,34/);
  assert.match(gs.find(g => g.chave === 'bitrix').itens[0].detalhe, /Card 7819 "EDIVALDO" sem contato/);
});

test('exportação: CSV com uma linha por item e HTML escapado, sem travessão', () => {
  const gs = inconsistencias({ ...base, avisosBitrix: [{ tipo: 'card_sem_contato', card: 1, titulo: '<b>X</b>' }] });
  const { cabecalho, linhas } = linhasCsv(gs);
  assert.equal(cabecalho.length, linhas[0].length);
  const html = htmlRelatorio(gs, { empresa: { razao: 'RT ENGENHARIA' }, de: '2026-10-01', ate: '2026-10-31' });
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(html.includes('01/10/2026 a 31/10/2026'));
  assert.ok(!html.includes('—'));
  assert.match(htmlRelatorio([], {}), /Nenhuma inconsistência/);
});

test('prova de vida só acusa quem falha bem mais que a média; intervalo tem 5 min de tolerância', () => {
  const dias = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];
  // todos falham (detector ruim): ninguém aparece
  const todos = ['p1', 'p2', 'p3'].flatMap(p => dias.map(d => marc(p, d, '07:00', 'entrada', { liveness_ok: false })));
  assert.ok(!inconsistencias({ ...base, marcacoes: todos }).some(g => g.chave === 'prova_vida'));
  // só a DIANA falha: aparece
  const uma = ['p1', 'p2', 'p3'].flatMap(p => dias.map(d => marc(p, d, '07:00', 'entrada')))
    .concat(dias.map(d => marc('p4', d, '07:00', 'entrada', { liveness_ok: false })));
  const pv = inconsistencias({ ...base, marcacoes: uma }).find(g => g.chave === 'prova_vida');
  assert.deepEqual(pv.itens.map(i => i.pessoa), ['DIANA']);
  assert.equal(pv.itens[0].detalhe, '4 de 4 batidas sem prova de vida');
  // intervalo de 58 min não acusa; 50 min acusa
  const dia = (d, volta) => [marc('p3', d, '07:00', 'entrada'), marc('p3', d, '11:00', 'saida'), marc('p3', d, volta, 'entrada'), marc('p3', d, '17:00', 'saida')];
  const linhas = [{ pessoa_id: 'p3', nome: 'CAIO', totais: { dias: 2 }, dias: ['2026-10-29', '2026-10-30'].map(d => ({ dia: d, equipe_id: 'e471', status: 'ok', saldo: 0, trabalhado: 540, marcacoes: 4 })) }];
  const gs = inconsistencias({ ...base, marcacoes: [...dia('2026-10-29', '11:58'), ...dia('2026-10-30', '11:50')], linhas });
  assert.deepEqual(gs.find(g => g.chave === 'clt_intervalo').itens.map(i => i.dia), ['2026-10-30']);
});

test('aglomerado a menos de 1 km da cerca não vira "lugar longe"', () => {
  const perto = { dentro_cerca: false, lat: -20.3863, lng: -54.5790, distancia_cerca_m: 250, estado: 'aceita' };
  const ms = ['2026-10-29', '2026-10-30', '2026-10-31'].flatMap(d => ['p3', 'p4'].map(p => marc(p, d, '07:00', 'entrada', perto)));
  assert.ok(!inconsistencias({ ...base, marcacoes: ms }).some(g => g.chave === 'cerca_errada'));
});
