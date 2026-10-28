import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutosTrabalhados, horasPorColaborador, fmtMinutos, dia as diaDe, tiposPelaOrdem, horarioDoDia, horasEntradaPorEquipe, diasDeFeriado, feriadosNacionais } from '../../js/regras.js';

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

test('hora extra e atraso além da tolerância (2 batidas: desconta o intervalo)', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:25'), mk('saida', '18:00')] });
  assert.equal(dia(r).trabalhado, 575); assert.equal(dia(r).saldo, 35); assert.equal(dia(r).intervalo_descontado, 60);
  assert.equal(dia(r).atraso, 25); assert.equal(r[0].totais.atrasos, 1);
});

test('atraso dentro da tolerância não conta e o saldo fica 0', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:08'), mk('saida', '17:00')] });
  assert.equal(dia(r).atraso, 0); assert.equal(r[0].totais.atrasos, 0);
  assert.equal(dia(r).saldo, 0); assert.equal(dia(r).na_tolerancia, true);
});

test('chegar 15 min antes e sair na hora, com 4 batidas: 15 min de extra (fora da tolerância)', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '06:45'), mk('saida', '11:00'), mk('entrada', '12:00'), mk('saida', '17:00')] });
  assert.equal(dia(r).saldo, 15); assert.equal(dia(r).intervalo_descontado, 0);
});

test('2 batidas sem almoço: 07–17 dá saldo 0, não +1h', () => {
  const r = horasPorColaborador({ ...base, marcacoes: [mk('entrada', '07:00'), mk('saida', '17:00')] });
  assert.equal(dia(r).trabalhado, 540); assert.equal(dia(r).saldo, 0);
});

test('turno curto de 2 batidas não desconta intervalo', () => {
  const r = horasPorColaborador({ ...base, alocacoes: [], marcacoes: [mk('entrada', '08:00'), mk('saida', '12:00')] });
  assert.equal(dia(r).trabalhado, 240); assert.equal(dia(r).intervalo_descontado, 0);
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

test('sem escala: dia útil com batida usa a jornada da equipe (caso Valmir +48h44); fim de semana é folga e vira extra', () => {
  const util = horasPorColaborador({ ...base, alocacoes: [], marcacoes: [mk('entrada', '07:00'), mk('saida', '11:00'), mk('entrada', '12:00'), mk('saida', '17:00')] });
  assert.equal(dia(util).status, 'ok'); assert.equal(dia(util).previsto, 540); assert.equal(dia(util).saldo, 0);
  const domingo = { marcado_dia: '2026-10-04' };
  const r = horasPorColaborador({ ...base, alocacoes: [], marcacoes: [
    mk('entrada', '08:00', { ...domingo, marcado_em: '2026-10-04T12:00:00Z' }), mk('saida', '10:00', { ...domingo, marcado_em: '2026-10-04T14:00:00Z' })] });
  const dom = r[0].dias.find(d => d.dia === '2026-10-04');
  assert.equal(dom.status, 'folga'); assert.equal(dom.previsto, 0); assert.equal(dom.saldo, 120);
  assert.equal(fmtMinutos(510), '8h30'); assert.equal(fmtMinutos(65, true), '+1h05'); assert.equal(fmtMinutos(-20, true), '-0h20'); assert.equal(fmtMinutos(0, true), '0h00');
});

test('dia no fuso da empresa: 21h em Campo Grande ainda é o mesmo dia (UTC já virou)', () => {
  assert.equal(diaDe('2026-10-06T01:30:00Z'), '2026-10-06');                         // legado: UTC
  assert.equal(diaDe('2026-10-06T01:30:00Z', 'America/Campo_Grande'), '2026-10-05');  // 21:30 do dia 5
  assert.equal(diaDe('2026-10-05T14:00:00Z', 'America/Campo_Grande'), '2026-10-05');
  assert.equal(diaDe('2026-10-05T14:00:00Z', 'fuso/invalido'), '2026-10-05');        // inválido cai no UTC
});

test('entrada/saída pela ordem do dia: tipo trocado no celular não quebra as horas (caso Valmir 07/10)', () => {
  // O celular gravou Entrada, Entrada, Saída, Entrada (o RH tinha anulado uma e lançado outra).
  const ms = [mk('entrada', '07:00', { origem: 'manual' }), mk('entrada', '11:47'), mk('saida', '12:59'), mk('entrada', '17:01')];
  const r = horasPorColaborador({ ...base, marcacoes: ms });
  assert.equal(dia(r).status, 'ok');
  assert.equal(dia(r).trabalhado, 287 + 242);   // 07:00–11:47 + 12:59–17:01
  const t = tiposPelaOrdem(ms);
  assert.deepEqual(t.map(m => m.tipo), ['entrada', 'saida', 'entrada', 'saida']);
  assert.equal(t[1].tipo_gravado, 'entrada');
  assert.equal(t[0], ms[0]);   // tipo já certo: mesmo objeto, sem cópia
});

test('tiposPelaOrdem separa por pessoa e por dia e ignora a ordem de chegada', () => {
  const ms = [
    mk('saida', '12:00'), mk('saida', '07:00'),
    mk('saida', '08:00', { pessoa_id: 'p2' }),
    mk('saida', '09:00', { marcado_dia: '2026-10-06', marcado_em: '2026-10-06T13:00:00Z' })
  ];
  assert.deepEqual(tiposPelaOrdem(ms).map(m => m.tipo), ['saida', 'entrada', 'entrada', 'entrada']);
});

test('equipe de afastamento (INSS): sem previsto, sem falta, dia aparece como afastado', () => {
  const r = horasPorColaborador({ ...base, equipes: [{ equipe_id: 'e1', jornada_id: 'j1', afastamento: true }], marcacoes: [], pessoaId: 'p1' });
  assert.equal(dia(r).status, 'afastado'); assert.equal(dia(r).previsto, 0); assert.equal(r[0].totais.faltas, 0); assert.equal(dia(r).saldo, null);
});

// Jornada da Efrat: segunda 07:00–16:00, terça a sexta 07:00–17:00, 1h de almoço (44h/semana).
const EFRAT = { jornada_id: 'j1', entrada: '07:00', saida: '17:00', tolerancia_min: 10, intervalo_min: 60,
  dias: { 1: { entrada: '07:00', saida: '16:00' }, 2: { entrada: '07:00', saida: '17:00' }, 3: { entrada: '07:00', saida: '17:00' },
          4: { entrada: '07:00', saida: '17:00' }, 5: { entrada: '07:00', saida: '17:00' } } };

test('horarioDoDia: jornada por dia da semana, folga no fim de semana, feriado sempre folga', () => {
  const fer = diasDeFeriado('2026-10-01', '2026-10-31');
  assert.deepEqual(horarioDoDia(EFRAT, '2026-10-05', fer), { entrada: '07:00', saida: '16:00', intervalo_min: 60 });   // segunda
  assert.equal(horarioDoDia(EFRAT, '2026-10-06', fer).saida, '17:00');   // terça
  assert.equal(horarioDoDia(EFRAT, '2026-10-10', fer), null);            // sábado
  assert.equal(horarioDoDia(EFRAT, '2026-10-10', fer, true).saida, '17:00');   // sábado escalado: horário base
  assert.equal(horarioDoDia(EFRAT, '2026-10-12', fer, true), null);      // N. Sra. Aparecida
  const legado = { entrada: '07:00', saida: '17:00', intervalo_min: 60 };
  assert.equal(horarioDoDia(legado, '2026-10-05', fer).saida, '17:00'); assert.equal(horarioDoDia(legado, '2026-10-11', fer), null);
  assert.equal(feriadosNacionais(2026).length, 9);
  assert.ok(diasDeFeriado('2026-08-01', '2026-08-31', [{ dia: '2026-08-26', nome: 'Aniversário de Campo Grande' }]).has('2026-08-26'));
});

test('segunda prevê 8h e terça 9h; feriado com batida é extra', () => {
  const ms = [mk('entrada', '07:00'), mk('saida', '11:00'), mk('entrada', '12:00'), mk('saida', '16:00')];
  const r = horasPorColaborador({ ...base, jornadas: [EFRAT], marcacoes: ms });
  assert.equal(dia(r).previsto, 480); assert.equal(dia(r).saldo, 0);
  const fer = '2026-10-12';
  const f = horasPorColaborador({ ...base, jornadas: [EFRAT], alocacoes: [], marcacoes: [
    mk('entrada', '07:00', { marcado_dia: fer, marcado_em: fer + 'T11:00:00Z' }), mk('saida', '11:00', { marcado_dia: fer, marcado_em: fer + 'T15:00:00Z' })] });
  const d = f[0].dias.find(x => x.dia === fer);
  assert.equal(d.status, 'feriado'); assert.equal(d.previsto, 0); assert.equal(d.saldo, 240);
});

test('falta sem escala: quem está na equipe deve os dias de trabalho desde que entrou, até hoje', () => {
  const pessoas = [{ pessoa_id: 'p1', nome: 'Ana', matricula: '1', ativo: true, equipe_id: 'e1', desde: '2026-10-06' }];
  const r = horasPorColaborador({ ...base, pessoas, jornadas: [EFRAT], alocacoes: [], marcacoes: [], de: '2026-10-01', ate: '2026-10-31', hoje: '2026-10-14' });
  const dias = r[0].dias.map(x => x.dia + ':' + x.status);
  assert.deepEqual(dias, ['2026-10-06:falta', '2026-10-07:falta', '2026-10-08:falta', '2026-10-09:falta',
                          '2026-10-13:falta', '2026-10-14:em_andamento']);   // 10–11 fim de semana, 12 feriado
  assert.equal(r[0].totais.faltas, 5); assert.equal(r[0].totais.saldo, -540 * 5 + 0);
});

test('horasEntradaPorEquipe: hora de entrada do dia; feriado = null (ninguém é cobrado)', () => {
  const eqs = [{ equipe_id: 'e1', jornada_id: 'j1' }];
  const fer = diasDeFeriado('2026-10-01', '2026-10-31');
  assert.deepEqual(horasEntradaPorEquipe(eqs, [EFRAT], '2026-10-06', fer), { e1: '07:00' });
  assert.deepEqual(horasEntradaPorEquipe(eqs, [EFRAT], '2026-10-12', fer), { e1: null });
});
