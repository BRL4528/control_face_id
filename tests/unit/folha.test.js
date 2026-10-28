import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folhaDoMes, rotuloObra, horasPorColaborador } from '../../js/regras.js';

// Fuso -04 (Campo Grande): 07:00 local = 11:00Z.
const em = (dia, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${dia}T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`; };
const b = (dia, hhmm, eq = 'o574') => ({ pessoa_id: 'p1', equipe_id: eq, tipo: 'entrada', marcado_em: em(dia, hhmm), marcado_dia: dia, estado: 'aceita' });
const NOMES = { o574: 'Obra 574 - Rio Verde (Elevatórias)', esc: 'Escritório Efrat' };
const dia4 = (dia, eq) => ['07:00', '11:00', '12:00', '17:00'].map(h => b(dia, h, eq));

test('rotuloObra: tira o "Obra" do código e põe em maiúsculas', () => {
  assert.equal(rotuloObra('Obra 574 - Rio Verde (Elevatórias)'), '574 - RIO VERDE (ELEVATÓRIAS)');
  assert.equal(rotuloObra('Escritório Efrat'), 'ESCRITÓRIO EFRAT');
  assert.equal(rotuloObra(null), '');
});

test('folhaDoMes: uma linha por dia, batidas, extra, falta e rateio por obra', () => {
  const marcacoes = [...dia4('2026-10-06', 'o574'), ...dia4('2026-10-07', 'esc'),
    b('2026-10-08', '07:00'), b('2026-10-08', '11:00'), b('2026-10-08', '12:00'), b('2026-10-08', '18:00')];
  const pessoas = [{ pessoa_id: 'p1', nome: 'João', matricula: '1', ativo: true, equipe_id: 'o574', desde: '2026-10-06' }];
  const [linha] = horasPorColaborador({ marcacoes, alocacoes: [], pessoas, equipes: [{ equipe_id: 'o574' }, { equipe_id: 'esc' }], jornadas: [],
    de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-13', fuso: 'America/Campo_Grande' });
  const f = folhaDoMes({ linha, marcacoes, mes: '2026-10', fuso: 'America/Campo_Grande', nomeEquipe: id => NOMES[id] });
  assert.equal(f.dias.length, 31);
  const d6 = f.dias[5];
  assert.deepEqual([d6.semana, d6.batidas.join(' '), d6.trabalhado, d6.extra, d6.obra], ['TERÇA', '07:00 11:00 12:00 17:00', 540, 0, '574 - RIO VERDE (ELEVATÓRIAS)']);
  assert.equal(f.dias[7].extra, 60);                 // 08/10 saiu 18:00
  assert.equal(f.dias[8].ocorrencia, 'FALTA');       // 09/10 sem batida
  assert.equal(f.dias[12].ocorrencia, '');           // 13/10 é hoje: em andamento, não falta
  assert.equal(f.totais.faltas, 1);
  assert.deepEqual(f.rateio.map(r => [r.obra, r.dias, r.minutos]), [['574 - RIO VERDE (ELEVATÓRIAS)', 2, 1140], ['ESCRITÓRIO EFRAT', 1, 540]]);
  assert.deepEqual([f.totais.dias_trabalhados, f.totais.extra, f.totais.trabalhado], [3, 60, 1680]);
  assert.equal(f.dias[11].ocorrencia, 'FERIADO');    // 12/10
});
