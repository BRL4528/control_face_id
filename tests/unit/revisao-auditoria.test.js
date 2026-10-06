import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivosDaRevisao, rotuloAuditoria } from '../../js/regras.js';

const bio = (extra = {}) => ({ origem: 'biometria', dentro_cerca: true, liveness_ok: true, deriva_relogio_ms: 0, score: 0.2, ...extra });

test('batida normal não tem motivo de revisão', () => {
  assert.deepEqual(motivosDaRevisao(bio()), []);
  assert.deepEqual(motivosDaRevisao(null), []);
});

test('cada sinal vira um motivo legível', () => {
  assert.match(motivosDaRevisao(bio({ dentro_cerca: false, distancia_cerca_m: 340 }))[0], /Fora da cerca \(340 m do centro\)/);
  assert.match(motivosDaRevisao(bio({ dentro_cerca: null }))[0], /Sem cerca definida/);
  assert.match(motivosDaRevisao(bio({ liveness_ok: false }))[0], /Prova de vida não detectada/);
  assert.match(motivosDaRevisao(bio({ deriva_relogio_ms: 5 * 60000 }))[0], /5 min fora/);
  assert.match(motivosDaRevisao(bio({ score: 0.52 }))[0], /zona cinzenta \(distância 0,52/);
  assert.match(motivosDaRevisao({ origem: 'manual', dentro_cerca: null })[0], /Registro manual/);
});

test('vários motivos juntos, e manual não acusa falta de cerca nem de rosto', () => {
  assert.equal(motivosDaRevisao(bio({ dentro_cerca: false, liveness_ok: false, score: 0.5 })).length, 3);
  assert.equal(motivosDaRevisao({ origem: 'manual', dentro_cerca: null, score: 0.9 }).length, 1);
});

test('rótulos da auditoria distinguem anular, corrigir, lançar, aprovar e aparelho', () => {
  assert.equal(rotuloAuditoria({ acao: 'rejeitar', alvo_tipo: 'marcacao', motivo: 'anulada pelo RH: x' }).txt, 'Anulou');
  assert.equal(rotuloAuditoria({ acao: 'rejeitar', alvo_tipo: 'marcacao', motivo: 'corrigida pelo RH (substituída por 1): x' }).txt, 'Corrigiu');
  assert.equal(rotuloAuditoria({ acao: 'rejeitar', alvo_tipo: 'marcacao', motivo: 'fora da obra' }).txt, 'Rejeitou');
  assert.equal(rotuloAuditoria({ acao: 'aprovar', alvo_tipo: 'marcacao', motivo: 'corrige abc: x' }).txt, 'Lançou (correção)');
  assert.equal(rotuloAuditoria({ acao: 'aprovar', alvo_tipo: 'marcacao', motivo: 'esqueceu', marcacao_origem: 'manual' }).txt, 'Lançou');
  assert.equal(rotuloAuditoria({ acao: 'aprovar', alvo_tipo: 'marcacao', motivo: 'ok', marcacao_origem: 'biometria' }).txt, 'Aprovou');
  assert.equal(rotuloAuditoria({ acao: 'bloquear', alvo_tipo: 'dispositivo' }).txt, 'Bloqueou aparelho');
  assert.equal(rotuloAuditoria({ acao: 'identificar', alvo_tipo: 'dispositivo' }).txt, 'Identificou aparelho');
  assert.equal(rotuloAuditoria({ acao: 'atribuir', alvo_tipo: 'marcacao' }).txt, 'Atribuiu batida');
});
