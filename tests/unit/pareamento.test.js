import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirPareamento } from '../../api/_lib/pareamento.js';
import { conferirProva, limiarValido, fotoValida, LIMIAR_PADRAO } from '../../api/_lib/prova-facial.js';
import { diaValido } from '../../api/_lib/data-real.js';

const alvo = { empresaId: 'B', hash: 'h-meu' };
const disp = extra => Object.assign({ empresa_id: 'B', colab_empresa_id: null, credencial_hash: 'h-meu', estado: 'pendente', ativo: true, colaborador_id: null }, extra);

test('decidirPareamento: dispositivo_id novo cria pendente', () => {
  assert.equal(decidirPareamento(null, alvo), 'novo');
});

test('decidirPareamento: aparelho de outra empresa ou de outra credencial dá conflito', () => {
  // Atacante na empresa B usa o dispositivo_id de um celular da empresa A.
  assert.equal(decidirPareamento(disp({ empresa_id: 'A', estado: 'ativo', colaborador_id: 'c1' }), alvo), 'conflito');
  // Mesma empresa, credencial diferente: é o aparelho de outra pessoa.
  assert.equal(decidirPareamento(disp({ credencial_hash: 'h-outro', estado: 'ativo', colaborador_id: 'c1' }), alvo), 'conflito');
  assert.equal(decidirPareamento(disp({ credencial_hash: 'h-outro' }), alvo), 'conflito');
  assert.equal(decidirPareamento(disp({ credencial_hash: null }), alvo), 'conflito');
  // Linha antiga sem empresa_id: vale a empresa do colaborador.
  assert.equal(decidirPareamento(disp({ empresa_id: null, colab_empresa_id: 'A', colaborador_id: 'c1', estado: 'ativo' }), alvo), 'conflito');
  // Bloqueado de outra pessoa não revela o estado: conflito, não 403.
  assert.equal(decidirPareamento(disp({ credencial_hash: 'h-outro', estado: 'bloqueado' }), alvo), 'conflito');
});

test('decidirPareamento: o próprio aparelho', () => {
  assert.equal(decidirPareamento(disp({ estado: 'bloqueado' }), alvo), 'bloqueado');
  assert.equal(decidirPareamento(disp({ estado: 'ativo', colaborador_id: 'c1' }), alvo), 'ja_ativo');
  assert.equal(decidirPareamento(disp(), alvo), 'pendente');
  // Desativado (a pessoa trocou de celular): volta a pendente, não reativa sozinho.
  assert.equal(decidirPareamento(disp({ estado: 'ativo', colaborador_id: 'c1', ativo: false }), alvo), 'pendente');
  assert.equal(decidirPareamento(disp({ empresa_id: null, colab_empresa_id: 'B', colaborador_id: 'c1', estado: 'ativo' }), alvo), 'ja_ativo');
});

const FOTO = 'data:image/jpeg;base64,AAAA';

test('conferirProva: sem prova, sem score ou sem foto é PROVA_FACIAL_AUSENTE (400)', () => {
  for (const p of [undefined, null, {}, { score: 0.1 }, { foto: FOTO }, { score: null, foto: FOTO },
                   { score: 'abc', foto: FOTO }, { score: -0.1, foto: FOTO }, { score: 0.1, foto: 'http://x/y.jpg' },
                   { score: 0.1, foto: 'data:image/jpeg;base64,' + 'A'.repeat(300001) }]) {
    const r = conferirProva(p, 0.45);
    assert.equal(r.ok, false, JSON.stringify(p && p.score));
    assert.equal(r.status, 400);
    assert.equal(r.codigo, 'PROVA_FACIAL_AUSENTE');
  }
});

test('conferirProva: score acima do limiar é ROSTO_NAO_CONFERE (403)', () => {
  const r = conferirProva({ score: 0.5, foto: FOTO, liveness_ok: true }, 0.45);
  assert.deepEqual([r.ok, r.status, r.codigo], [false, 403, 'ROSTO_NAO_CONFERE']);
  // Limiar da empresa mais folgado aceita.
  assert.equal(conferirProva({ score: 0.5, foto: FOTO }, 0.55).ok, true);
});

test('conferirProva: 1:1 dentro do limiar passa; prova de vida só é registrada', () => {
  const r = conferirProva({ score: '0.12', foto: FOTO, liveness_ok: false }, 0.45);
  assert.deepEqual(r, { ok: true, score: 0.12, foto: FOTO, liveness_ok: false });
  assert.equal(conferirProva({ score: 0.45, foto: FOTO, liveness_ok: true }).liveness_ok, true);   // no limiar ainda vale
});

test('limiarValido: faixa segura, senão o padrão', () => {
  assert.equal(LIMIAR_PADRAO, 0.45);
  assert.equal(limiarValido('0.5'), 0.5);
  for (const v of [null, undefined, '', 'x', 0.1, 0.95, 2]) assert.equal(limiarValido(v), 0.45);
  assert.equal(fotoValida(FOTO), FOTO);
  assert.equal(fotoValida('data:image/gif;base64,AAAA'), null);
});

test('diaValido: só data de calendário real', () => {
  for (const d of ['2026-02-28', '2028-02-29', '2026-12-31', '2026-01-01']) assert.equal(diaValido(d), true, d);
  for (const d of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-01', '', null, undefined, 20260101, '2026-01-01T00:00'])
    assert.equal(diaValido(d), false, String(d));
});
