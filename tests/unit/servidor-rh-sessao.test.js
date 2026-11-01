// Regras de servidor da 2ª bateria: sessão do RH presa à senha atual, senha
// temporária só troca a senha, atribuição de batida de aparelho pendente com a
// cerca da equipe, estados de ocorrência e de entrega de EPI. Funções puras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { carimboSenha, carimboConfere, emitirTokenRh } from '../../api/_lib/auth.js';
import { sessaoDoUsuario, bloqueioDeAcesso } from '../../api/_lib/acesso.js';
import { respostaSenhaTemporaria } from '../../api/rh/dados.js';
import { revisaoDaAtribuicao } from '../../api/rh/decidir.js';
import { transicaoOcorrencia } from '../../api/rh/ocorrencia.js';
import { motivoNaoCancelavel } from '../../api/rh/almox.js';

test('carimbo da senha: estável para o mesmo hash, muda quando a senha muda, curto e sem o hash', () => {
  const a = carimboSenha('$2a$10$hashantigo'), b = carimboSenha('$2a$10$hashnovo');
  assert.equal(a, carimboSenha('$2a$10$hashantigo'));
  assert.notEqual(a, b);
  assert.equal(a.length, 8);
  assert.equal(carimboSenha(null), null);
  assert.equal(carimboConfere({ cs: a }, '$2a$10$hashantigo'), true);
  assert.equal(carimboConfere({ cs: a }, '$2a$10$hashnovo'), false);   // trocou a senha
  assert.equal(carimboConfere({}, '$2a$10$hashantigo'), false);        // token sem carimbo (antigo)
  assert.equal(carimboConfere(null, 'x'), false);
});

test('token do RH leva o carimbo da senha de quem logou', () => {
  const t = emitirTokenRh({ id: 'u1', empresa_id: 'E', usuario: 'rh', nome: 'RH', chave_hash: 'H1' });
  const p = jwt.decode(t);
  assert.equal(p.sub, 'u1');
  assert.equal(p.cs, carimboSenha('H1'));
});

test('sessão: inativo, carimbo velho ou ausente é 401; senha temporária passa com a marca', () => {
  const rh = { sub: 'u1', cs: carimboSenha('H1') };
  const u = { ativo: true, chave_hash: 'H1', trocar_senha: false, perfil: 'rh', obras: null };
  assert.deepEqual(sessaoDoUsuario(u, rh), { perfil: 'rh', obras: [], trocar_senha: false });
  assert.equal(sessaoDoUsuario(Object.assign({}, u, { ativo: false }), rh), null);
  assert.equal(sessaoDoUsuario(Object.assign({}, u, { chave_hash: 'H2' }), rh), null);   // senha trocada/redefinida
  assert.equal(sessaoDoUsuario(u, { sub: 'u1' }), null);
  assert.equal(sessaoDoUsuario(null, rh), null);
  assert.equal(sessaoDoUsuario(Object.assign({}, u, { trocar_senha: true }), rh).trocar_senha, true);
});

test('exigeAcesso: senha temporária é 403 TROCAR_SENHA em qualquer módulo, até para administrador', () => {
  assert.deepEqual(bloqueioDeAcesso(null, 'ponto', false), { status: 401, codigo: 'SESSAO_INVALIDA', msg: 'faça login novamente' });
  for (const modulo of ['ponto', 'pessoas', 'config', 'almox']) {
    assert.equal(bloqueioDeAcesso({ perfil: null, obras: [], trocar_senha: true }, modulo, false).codigo, 'TROCAR_SENHA');
  }
  assert.equal(bloqueioDeAcesso({ perfil: null, obras: [], trocar_senha: false }, 'config', true), null);
  assert.equal(bloqueioDeAcesso({ perfil: 'almox', obras: [], trocar_senha: false }, 'config', true).codigo, 'SEM_PERMISSAO');
});

test('/rh/dados com senha temporária: nome e perfil, listas vazias, sem link da empresa', () => {
  const r = respostaSenhaTemporaria({ rh: { sub: 'u1', nome: 'Ana', usuario: 'ana', empresa_id: 'E' },
    empresa: { nome: 'Efrat', fuso: 'America/Campo_Grande', link_token: 'segredo' }, acesso: { perfil: 'rh', obras: [] },
    dias: 30, hoje: '2026-11-01', perfil: 'rh', rotulo: 'RH' });
  assert.equal(r.trocar_senha, true);
  assert.equal(r.usuario.nome, 'Ana');
  assert.equal(r.empresa.link_token, null);
  for (const k of ['equipes', 'pessoas', 'marcacoes', 'locais', 'jornadas', 'planos', 'papeis', 'ocorrencias',
    'usuarios_rh', 'correcoes', 'alocacoes', 'alocacoes_hoje', 'aparelhos_pendentes', 'recadastros']) {
    assert.deepEqual(r[k], [], k);
  }
});

test('atribuir batida de aparelho pendente: dentro da cerca da equipe sai aceita', () => {
  const r = revisaoDaAtribuicao({ temCerca: true, cerca: { dentro: true, distancia_m: 12 }, liveness_ok: true, afastado: false, ocorrencia: null });
  assert.equal(r.revisar, false);
  assert.equal(r.motivo, 'identificado pelo RH');
});

test('atribuir batida: sem cerca, fora dela ou sem prova de vida continua em revisão, com todos os motivos', () => {
  assert.deepEqual(revisaoDaAtribuicao({ temCerca: false, cerca: { dentro: null, distancia_m: null }, liveness_ok: true }).motivo, 'sem cerca no dia');
  const r = revisaoDaAtribuicao({ temCerca: true, cerca: { dentro: false, distancia_m: 900 }, liveness_ok: false });
  assert.equal(r.revisar, true);
  assert.equal(r.motivo, 'fora da cerca · sem prova de vida');
});

test('atribuir batida: viagem dispensa a cerca; férias e afastamento vão para o RH', () => {
  const viagem = { tipo: 'viagem', rotulo: 'Viagem / trabalho externo', semCerca: true };
  const v = revisaoDaAtribuicao({ temCerca: true, cerca: { dentro: false, distancia_m: 5000 }, liveness_ok: true, ocorrencia: viagem });
  assert.equal(v.revisar, false);
  assert.equal(v.cerca.dentro, true);
  assert.match(v.motivo, /trabalho externo/);
  const inss = { tipo: 'afastamento_inss', rotulo: 'Afastamento INSS', bloqueia: true };
  const a = revisaoDaAtribuicao({ temCerca: true, cerca: { dentro: true, distancia_m: 1 }, liveness_ok: true, ocorrencia: inss });
  assert.equal(a.revisar, true);
  assert.equal(a.motivo, 'colaborador em afastamento INSS');
  assert.equal(revisaoDaAtribuicao({ temCerca: true, cerca: { dentro: true }, liveness_ok: true, afastado: true }).motivo, 'colaborador afastado');
});

test('ocorrência: cancelar só ativa ou pendente; aprovar e recusar só pendente', () => {
  assert.deepEqual(transicaoOcorrencia('cancelar', 'ativa'), { para: 'cancelada' });
  assert.deepEqual(transicaoOcorrencia('cancelar', 'pendente'), { para: 'cancelada' });
  assert.ok(transicaoOcorrencia('cancelar', 'recusada').erro);
  assert.ok(transicaoOcorrencia('cancelar', 'cancelada').erro);
  assert.deepEqual(transicaoOcorrencia('aprovar', 'pendente'), { para: 'ativa' });
  assert.deepEqual(transicaoOcorrencia('recusar', 'pendente'), { para: 'recusada' });
  assert.ok(transicaoOcorrencia('aprovar', 'ativa').erro);
  assert.ok(transicaoOcorrencia('recusar', 'cancelada').erro);
  assert.ok(transicaoOcorrencia('apagar', 'ativa').erro);
});

test('EPI: mensagens do 409 ao cancelar entrega confirmada ou devolvida, sem travessão', () => {
  for (const e of ['confirmada', 'devolvida', 'cancelada', 'outro']) {
    const m = motivoNaoCancelavel(e);
    assert.ok(m.length > 10, e);
    assert.equal(/[—–]/.test(m), false, e);
  }
  assert.match(motivoNaoCancelavel('confirmada'), /devolução/);
});
