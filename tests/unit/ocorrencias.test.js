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
