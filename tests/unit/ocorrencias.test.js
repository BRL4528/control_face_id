import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocorrenciaDoDia, TIPOS_OCORRENCIA } from '../../js/ocorrencias.js';
import { horasPorColaborador, folhaDoMes } from '../../js/regras.js';

const oc = (tipo, inicio, fim, extra = {}) => ({ colaborador_id: 'p1', tipo, inicio, fim, estado: 'ativa', ...extra });

test('ocorrenciaDoDia: período fechado e em aberto, estado e prioridade', () => {
  const lista = [oc('viagem', '2026-10-05', '2026-10-09'), oc('atestado', '2026-10-07', '2026-10-07'),
                 oc('afastamento_inss', '2026-10-20', null), oc('ferias', '2026-10-01', '2026-10-02', { estado: 'pendente' })];
  assert.equal(ocorrenciaDoDia(lista, 'p1', '2026-10-06').tipo, 'viagem');
  assert.equal(ocorrenciaDoDia(lista, 'p1', '2026-10-07').tipo, 'atestado');   // atestado vence a viagem
  assert.equal(ocorrenciaDoDia(lista, 'p1', '2026-12-31').tipo, 'afastamento_inss');   // sem fim
  assert.equal(ocorrenciaDoDia(lista, 'p1', '2026-10-01'), null);              // pendente não vale
  assert.equal(ocorrenciaDoDia(lista, 'p2', '2026-10-07'), null);
  assert.ok(TIPOS_OCORRENCIA.ferias.bloqueia && TIPOS_OCORRENCIA.viagem.semCerca && !TIPOS_OCORRENCIA.atestado.bloqueia);
});

test('férias e atestado abonam: sem falta, sem previsto, e a folha mostra o motivo', () => {
  const pessoas = [{ pessoa_id: 'p1', nome: 'Ana', matricula: '1', ativo: true, equipe_id: 'e1', desde: '2026-10-01' }];
  const base = { marcacoes: [], alocacoes: [], pessoas, equipes: [{ equipe_id: 'e1' }], jornadas: [],
    de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-28', fuso: 'America/Campo_Grande' };
  const ocorrencias = [oc('ferias', '2026-10-05', '2026-10-09'), oc('atestado', '2026-10-13', '2026-10-13')];
  const [l] = horasPorColaborador({ ...base, ocorrencias });
  const d = dia => l.dias.find(x => x.dia === dia);
  assert.deepEqual([d('2026-10-06').status, d('2026-10-06').ocorrencia, d('2026-10-06').previsto, d('2026-10-06').saldo], ['ocorrencia', 'ferias', 0, null]);
  assert.equal(d('2026-10-13').ocorrencia, 'atestado');
  assert.equal(d('2026-10-14').status, 'falta');
  const semOc = horasPorColaborador({ ...base })[0].totais.faltas;
  assert.equal(l.totais.faltas, semOc - 6);   // 5 dias de férias + 1 de atestado deixam de ser falta
  const f = folhaDoMes({ linha: l, marcacoes: [], mes: '2026-10', fuso: base.fuso, nomeEquipe: () => 'Obra 574 - X' });
  assert.equal(f.dias[5].ocorrencia, 'FÉRIAS'); assert.equal(f.dias[12].ocorrencia, 'ATESTADO'); assert.equal(f.dias[13].ocorrencia, 'FALTA');
});

test('aviso prévio: dia trabalhado normal e a folha marca SOBRE AVISO', () => {
  const pessoas = [{ pessoa_id: 'p1', nome: 'Ana', matricula: '1', ativo: true, equipe_id: 'e1', desde: '2026-10-01' }];
  const em = h => '2026-10-21T' + String(h + 4).padStart(2, '0') + ':00:00Z';
  const marcacoes = [7, 11, 12, 17].map(h => ({ pessoa_id: 'p1', equipe_id: 'e1', tipo: 'entrada', marcado_em: em(h), marcado_dia: '2026-10-21', estado: 'aceita' }));
  const [l] = horasPorColaborador({ marcacoes, alocacoes: [], pessoas, equipes: [{ equipe_id: 'e1' }], jornadas: [],
    de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-28', fuso: 'America/Campo_Grande', ocorrencias: [oc('aviso_previo', '2026-10-19', '2026-10-30')] });
  const d = l.dias.find(x => x.dia === '2026-10-21');
  assert.deepEqual([d.status, d.trabalhado, d.ocorrencia], ['ok', 540, 'aviso_previo']);
  const f = folhaDoMes({ linha: l, marcacoes, mes: '2026-10', fuso: 'America/Campo_Grande', nomeEquipe: () => 'X' });
  assert.equal(f.dias[20].ocorrencia, 'SOBRE AVISO');
  assert.equal(f.dias[21].ocorrencia, 'FALTA');   // 22/10 sem batida: aviso prévio não abona
});

test('dia de férias com batida continua ocorrência: saldo 0, sem hora extra, conflito marcado', () => {
  const pessoas = [{ pessoa_id: 'p1', nome: 'Ana', matricula: '1', ativo: true, equipe_id: 'e1', desde: '2026-10-01' }];
  const em = h => '2026-10-06T' + String(h + 4).padStart(2, '0') + ':00:00Z';
  const marcacoes = [7, 11, 12, 17].map(h => ({ pessoa_id: 'p1', equipe_id: 'e1', tipo: 'entrada', marcado_em: em(h), marcado_dia: '2026-10-06', estado: 'aceita' }));
  const [l] = horasPorColaborador({ marcacoes, alocacoes: [], pessoas, equipes: [{ equipe_id: 'e1' }], jornadas: [],
    de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-28', fuso: 'America/Campo_Grande', ocorrencias: [oc('ferias', '2026-10-05', '2026-10-09')] });
  const d = l.dias.find(x => x.dia === '2026-10-06');
  assert.deepEqual([d.status, d.ocorrencia, d.saldo, d.conflito_ocorrencia], ['ocorrencia', 'ferias', 0, true]);
  assert.equal(l.dias.find(x => x.dia === '2026-10-07').conflito_ocorrencia, false);   // férias sem batida: sem conflito
  const f = folhaDoMes({ linha: l, marcacoes, mes: '2026-10', fuso: 'America/Campo_Grande', nomeEquipe: () => 'X' });
  assert.equal(f.dias[5].extra, 0);
  assert.equal(f.totais.extra, 0);
  assert.equal(f.dias[5].ocorrencia, 'FÉRIAS');
});
