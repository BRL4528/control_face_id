import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarComentario } from '../../api/_lib/bitrix-saida.js';

const base = { acao: 'aprovar', decisao: 'obra sem sinal', rh: 'RH', alvoId: 'm-1', fuso: 'America/Campo_Grande', agora: new Date('2026-10-06T12:00:00Z') };

test('marcação: traz decisão, quem decidiu, dados do registro e id', () => {
  const t = montarComentario({ ...base, tipo: 'marcacao', alvo: {
    tipo: 'saida', origem: 'biometria', veredito: 'revisar', motivo_revisao: 'fora_da_cerca',
    marcado_em: '2026-10-06T11:00:00Z', dentro_cerca: false, distancia_cerca_m: 230, lat: -20.4, lng: -54.6, precisao_m: 12, equipe: 'Obra 1' } });
  for (const trecho of ['APROVADO', 'obra sem sinal', 'Saída em 06/10/2026', 'fora da cerca (230 m', '±12 m', 'equipe Obra 1', 'm-1']) {
    assert.ok(t.includes(trecho), trecho);
  }
});

test('rejeição de cadastro facial', () => {
  const t = montarComentario({ ...base, acao: 'rejeitar', tipo: 'template', alvoId: 't-9', alvo: { versao: 3, origem: 'autocadastro', criado_em: '2026-10-05T10:00:00Z' } });
  assert.ok(t.includes('REJEITADO') && t.includes('versão 3') && t.includes('t-9'));
});

test('marcação sem GPS nem cerca não quebra', () => {
  const t = montarComentario({ ...base, tipo: 'marcacao', alvo: { tipo: 'entrada', marcado_em: '2026-10-06T11:00:00Z', dentro_cerca: null } });
  assert.ok(t.includes('sem cerca definida') && t.includes('sem GPS'));
});
