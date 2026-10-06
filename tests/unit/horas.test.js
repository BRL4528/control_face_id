import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutosTrabalhados, horasPorColaborador, fmtMinutos } from '../../js/regras.js';

// Fuso -04 (Campo Grande): 07:00 local = 11:00Z.
const z = (hhmmLocal) => { const [h, m] = hhmmLocal.split(':').map(Number); return `2026-10-05T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`; };
const mk = (tipo, hhmm, extra = {}) => ({ pessoa_id: 'p1', equipe_id: 'e1', tipo, marcado_em: z(hhmm), marcado_dia: '2026-10-05', estado: 'aceita', ...extra });
const base = {
  pessoas: [{ pessoa_id: 'p1', nome: 'Ana', matricula: '1' }],
  equipes: [{ equipe_id: 'e1', jornada_id: 'j1' }],
  jornadas: [{ jornada_id: 'j1', entrada: '07:00', saida: '17:00', tolerancia_min: 10, intervalo_min: 60 }],
  alocacoes: [{ dia: '2026-10-05', colaborador_id: 'p1', equipe_id: 'e1' }],
  de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-20', fuso: 'America/Campo_Grande'
};
const dia = (r) => r[0].dias.find(d => d.dia === '2026-10-05');

test('pares entrada→saída; entrada sem saída é incompleto e não chuta horas', () => {
  assert.deepEqual(minutosTrabalhados([mk('entrada', '07:00'), mk('saida', '11:00'), mk('entrada', '12:00'), mk('saida', '17:00')]), { minutos: 540, incompleto: false });
  assert.deepEqual(minutosTrabalhados([mk('entrada', '07:00'), mk('saida', '11:00'), mk('entrada', '12:00')]), { minutos: 240, incompleto: true });
  assert.equal(minutosTrabalhados([mk('saida', '11:00')]).incompleto, true);
});

test('dia completo: 9h trabalhadas × 9h previstas (10h − 1h de intervalo) = saldo 0', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:00'), mk('saida', '11:00'), mk('entrada', '12:00'), mk('saida', '17:00')] });
  assert.equal(dia(r).previsto, 540); assert.equal(dia(r).trabalhado, 540); assert.equal(dia(r).saldo, 0);
  assert.equal(r[0].totais.saldo, 0); assert.equal(dia(r).status, 'ok');
});

test('hora extra e atraso além da tolerância', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:25'), mk('saida', '18:00')] });
  assert.equal(dia(r).trabalhado, 635); assert.equal(dia(r).saldo, 95);
  assert.equal(dia(r).atraso, 25); assert.equal(r[0].totais.atrasos, 1);
});

test('atraso dentro da tolerância não conta', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:08'), mk('saida', '17:00')] });
  assert.equal(dia(r).atraso, 0); assert.equal(r[0].totais.atrasos, 0);
});

test('marcação rejeitada é ignorada; pendente tira o dia do saldo e vai para a_confirmar', () => {
  const rej = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:00'), mk('saida', '17:00', { estado: 'rejeitada' })] });
  assert.equal(dia(rej).status, 'incompleto');
  const pen = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:00'), mk('saida', '17:00', { estado: 'pendente' })] });
  assert.equal(dia(pen).status, 'a_confirmar'); assert.equal(dia(pen).saldo, null);
  assert.equal(pen[0].totais.a_confirmar, 600); assert.equal(pen[0].totais.previsto, 0);
});

test('dia escalado sem batida no passado é falta; hoje é em andamento', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [], pessoaId: 'p1' });
  assert.equal(dia(r).status, 'falta'); assert.equal(dia(r).saldo, -540); assert.equal(r[0].totais.faltas, 1);
  const h = horasPorColaborador({ ...base, marcacoes: [], hoje: '2026-10-05' });
  assert.equal(dia(h).status, 'em_andamento'); assert.equal(h[0].totais.faltas, 0);
});

test('batida sem escala conta tudo como extra; fmtMinutos', () => {
  const r = horasPorColaborador({ ...base, alocacoes: [], marcacoes: [mk('entrada', '08:00'), mk('saida', '10:00')] });
  assert.equal(dia(r).status, 'sem_escala'); assert.equal(dia(r).saldo, 120);
  assert.equal(fmtMinutos(510), '8h30'); assert.equal(fmtMinutos(65, true), '+1h05'); assert.equal(fmtMinutos(-20, true), '-0h20');
});
