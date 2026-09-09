import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarSnapshot, resumirColaboradores, resumirEquipes, SnapshotInvalido } from '../../api/_lib/bitrix.js';

const ETAPAS = [
  { id: 'C13:UC_ALOCAR', nome: 'A alocar', ordem: 10 },
  { id: 'C13:NEW', nome: 'Escritório Efrat', ordem: 20 },
  { id: 'C13:PREPAYMENT_INVOIC', nome: 'Obra 423 - Residencial Jerivás', ordem: 40 },
  { id: 'C13:WON', nome: 'Desligado / Saída da equipe', ordem: 200 },
  { id: 'C13:LOSE', nome: 'Arquivado', ordem: 210 }
];
const card = (id, etapa, contato, extra) => Object.assign({ id, etapa, fechado: false, contato: { id: contato, nome: 'PESSOA ' + contato } }, extra || {});

test('normalizarSnapshot exige etapas e cards', () => {
  assert.throws(() => normalizarSnapshot(null), SnapshotInvalido);
  assert.throws(() => normalizarSnapshot({ etapas: [], cards: [] }), /nenhuma etapa/);
  assert.throws(() => normalizarSnapshot({ etapas: ETAPAS }), SnapshotInvalido);
});

test('"A alocar" vira sem_equipe sozinha e WON/LOSE são finais mesmo sem flag', () => {
  const s = normalizarSnapshot({ etapas: ETAPAS, cards: [] });
  const porId = Object.fromEntries(s.etapas.map(e => [e.id, e]));
  assert.equal(porId['C13:UC_ALOCAR'].sem_equipe, true);
  assert.equal(porId['C13:NEW'].sem_equipe, false);
  assert.equal(porId['C13:WON'].final, true);
  assert.equal(porId['C13:LOSE'].final, true);
  assert.equal(porId['C13:PREPAYMENT_INVOIC'].final, false);
});

test('flag sem_equipe explícita do n8n tem prioridade sobre o nome', () => {
  const etapas = [{ id: 'X:1', nome: 'Banco', sem_equipe: true }, { id: 'X:2', nome: 'A alocar' }];
  const s = normalizarSnapshot({ etapas, cards: [] });
  assert.deepEqual(s.etapas.map(e => e.sem_equipe), [true, false]);
});

test('card sem contato é ignorado com aviso; card em etapa final fica fechado', () => {
  const s = normalizarSnapshot({ etapas: ETAPAS, cards: [
    { id: '1', etapa: 'C13:NEW', titulo: 'SEM CONTATO', contato: { id: '0' } },
    card('2', 'C13:WON', '77')
  ] });
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0].fechado, true);
  assert.deepEqual(s.avisos, [{ tipo: 'card_sem_contato', card: '1', titulo: 'SEM CONTATO' }]);
});

test('contato em mais de um card: aberto ganha de fechado, depois o mais recente', () => {
  const s = normalizarSnapshot({ etapas: ETAPAS, cards: [
    card('10', 'C13:NEW', '5', { alterado_em: '2026-09-01T10:00:00Z' }),
    card('11', 'C13:PREPAYMENT_INVOIC', '5', { alterado_em: '2026-09-08T10:00:00Z' }),
    card('12', 'C13:WON', '5', { alterado_em: '2026-09-09T10:00:00Z' })
  ] });
  assert.equal(s.cards.length, 1);
  assert.equal(s.cards[0].card, '11');
  assert.equal(s.cards[0].etapa, 'C13:PREPAYMENT_INVOIC');
  const aviso = s.avisos.find(a => a.tipo === 'contato_em_mais_de_um_card');
  assert.deepEqual(aviso, { tipo: 'contato_em_mais_de_um_card', contato: '5', cards: ['10', '11', '12'] });
});

test('nome vem do título do card, senão do contato; etapa desconhecida vira aviso', () => {
  const s = normalizarSnapshot({ etapas: ETAPAS, cards: [
    { id: '1', etapa: 'C13:NEW', titulo: 'TITULO DO CARD', contato: { id: '9', nome: 'Cliente 5567999' } },
    { id: '3', etapa: 'C13:NEW', titulo: '', contato: { id: '7', nome: 'NOME DO CONTATO' } },
    { id: '2', etapa: 'C99:NADA', contato: { id: '8', nome: 'X' } }
  ] });
  assert.equal(s.cards[0].nome, 'TITULO DO CARD');
  assert.equal(s.cards[1].nome, 'NOME DO CONTATO');
  assert.deepEqual(s.avisos, [{ tipo: 'card_em_etapa_desconhecida', card: '2', etapa: 'C99:NADA' }]);
});

test('resumirColaboradores conta criados, movidos, desativados e reativados só dos vinculados', () => {
  const antes = [
    { id: 'a', nome: 'A', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: '1' },
    { id: 'b', nome: 'B', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: '2' },
    { id: 'c', nome: 'C', equipe_padrao: null, ativo: false, bitrix_contact_id: '3' },
    { id: 'd', nome: 'DEMO', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: null },
    { id: 'e', nome: 'E', equipe_padrao: null, ativo: true, bitrix_contact_id: null }   // adotado agora
  ];
  const depois = [
    { id: 'a', nome: 'A', equipe_padrao: 'e2', ativo: true, bitrix_contact_id: '1' },     // movido
    { id: 'b', nome: 'B', equipe_padrao: 'e1', ativo: false, bitrix_contact_id: '2' },    // desativado
    { id: 'c', nome: 'C', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: '3' },     // reativado (+ equipe)
    { id: 'd', nome: 'DEMO', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: null },
    { id: 'e', nome: 'E', equipe_padrao: 'e1', ativo: true, bitrix_contact_id: '5' },     // criado (vínculo novo)
    { id: 'f', nome: 'F', equipe_padrao: 'e2', ativo: true, bitrix_contact_id: '6' }      // criado
  ];
  assert.deepEqual(resumirColaboradores(antes, depois),
    { criados: 2, atualizados: 3, movidos: 2, desativados: 1, reativados: 1 });
});

test('resumirEquipes conta criadas, renomeadas e desativadas', () => {
  const antes = [
    { id: 'e1', nome: 'Obra 1', ativo: true, bitrix_stage_id: 'S1' },
    { id: 'e2', nome: 'Obra 2', ativo: true, bitrix_stage_id: 'S2' },
    { id: 'e3', nome: 'Manual', ativo: true, bitrix_stage_id: null }
  ];
  const depois = [
    { id: 'e1', nome: 'Obra 1 - Renomeada', ativo: true, bitrix_stage_id: 'S1' },
    { id: 'e2', nome: 'Obra 2', ativo: false, bitrix_stage_id: 'S2' },
    { id: 'e3', nome: 'Manual', ativo: true, bitrix_stage_id: 'S3' },
    { id: 'e4', nome: 'Obra 4', ativo: true, bitrix_stage_id: 'S4' }
  ];
  assert.deepEqual(resumirEquipes(antes, depois), { criadas: 2, renomeadas: 1, desativadas: 1, reativadas: 0 });
});
