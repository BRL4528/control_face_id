import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pode, obrasDe, perfilDe, PERFIS, ABA_MODULO, MODULOS } from '../../js/acessos.js';

test('sem perfil gravado é administrador (usuários anteriores ao controle)', () => {
  assert.equal(perfilDe(null), 'admin'); assert.equal(perfilDe({ perfil: 'xyz' }), 'admin');
  assert.equal(pode({}, 'config', true), true); assert.equal(obrasDe({}), null);
});

test('perfis: o que vê e o que altera', () => {
  assert.equal(pode({ perfil: 'rh' }, 'config'), false);
  assert.equal(pode({ perfil: 'rh' }, 'saude', true), true);
  assert.equal(pode({ perfil: 'gestor_obra' }, 'saude'), false);          // foto de atestado só RH/admin
  assert.equal(pode({ perfil: 'gestor_obra' }, 'ponto', true), true);
  assert.equal(pode({ perfil: 'gestor_obra' }, 'ocorrencias', true), false);
  assert.equal(pode({ perfil: 'sst' }, 'almox', true), true);
  assert.equal(pode({ perfil: 'almox' }, 'ponto'), false);
  assert.equal(pode({ perfil: 'leitura' }, 'ponto'), true); assert.equal(pode({ perfil: 'leitura' }, 'ponto', true), false);
});

test('gestor de obra vê só as obras dele', () => {
  assert.deepEqual(obrasDe({ perfil: 'gestor_obra', obras: ['e1'] }), ['e1']);
  assert.deepEqual(obrasDe({ perfil: 'gestor_obra' }), []);
  assert.equal(obrasDe({ perfil: 'rh', obras: ['e1'] }), null);
});

test('toda aba e todo perfil apontam para módulos existentes', () => {
  for (const m of Object.values(ABA_MODULO)) assert.ok(MODULOS[m], m);
  for (const p of Object.values(PERFIS)) for (const m of p.ver.concat(p.editar)) assert.ok(MODULOS[m], m);
  for (const p of Object.values(PERFIS)) for (const m of p.editar) assert.ok(p.ver.includes(m), 'edita sem ver: ' + m);
});

test('servidor: exigeAcesso barra perfil sem permissão e usuário desativado; noEscopo por obra', async () => {
  const { exigeAcesso, noEscopo } = await import('../../api/_lib/acesso.js');
  const { carimboSenha } = await import('../../api/_lib/auth.js');
  const usuarios = { u1: { ativo: true, perfil: 'almox', obras: null }, u2: { ativo: false, perfil: null }, u3: { ativo: true, perfil: null, obras: null },
                     u4: { ativo: true, perfil: 'gestor_obra', obras: ['e1'] }, u5: { ativo: true, perfil: null, obras: null, trocar_senha: true } };
  for (const u of Object.values(usuarios)) u.chave_hash = 'hash-atual';
  const colabs = { c1: { equipe_padrao: 'e1' }, c2: { equipe_padrao: 'e2' } };
  const sql = (partes, ...v) => {
    const q = partes.join('?');
    if (q.includes('FROM usuario_rh')) return Promise.resolve(usuarios[v[0]] ? [usuarios[v[0]]] : []);
    if (q.includes('FROM colaborador')) return Promise.resolve(colabs[v[0]] ? [colabs[v[0]]] : []);
    return Promise.resolve([]);
  };
  const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {}, end() {} });
  const cs = carimboSenha('hash-atual');
  let r = res();
  assert.equal(await exigeAcesso(r, sql, { sub: 'u1', empresa_id: 'x', cs }, 'ponto', true), null); assert.equal(r.statusCode, 403);
  r = res(); assert.ok(await exigeAcesso(r, sql, { sub: 'u1', empresa_id: 'x', cs }, 'almox', true));
  r = res(); assert.equal(await exigeAcesso(r, sql, { sub: 'u2', empresa_id: 'x', cs }, 'ponto', false), null); assert.equal(r.statusCode, 401);
  r = res(); assert.ok(await exigeAcesso(r, sql, { sub: 'u3', empresa_id: 'x', cs }, 'config', true));   // sem perfil = admin
  // Senha trocada depois do login: o carimbo do token não bate mais.
  r = res(); assert.equal(await exigeAcesso(r, sql, { sub: 'u3', empresa_id: 'x', cs: carimboSenha('hash-velho') }, 'config', true), null); assert.equal(r.statusCode, 401);
  // Senha temporária: só troca a senha.
  r = res(); assert.equal(await exigeAcesso(r, sql, { sub: 'u5', empresa_id: 'x', cs }, 'ponto', false), null); assert.equal(r.statusCode, 403);
  assert.equal(r.body.erro.codigo, 'TROCAR_SENHA');
  const g = await exigeAcesso(res(), sql, { sub: 'u4', empresa_id: 'x', cs }, 'ponto', true);
  assert.equal(await noEscopo(sql, g, 'x', 'c1'), true);
  assert.equal(await noEscopo(sql, g, 'x', 'c2'), false);
});

test('podeEditarJornadas: gestor de obra e leitura não criam nem editam jornada', async () => {
  const { podeEditarJornadas } = await import('../../js/acessos.js');
  assert.equal(podeEditarJornadas({ perfil: 'gestor_obra', obras: ['o1'] }), false);
  assert.equal(podeEditarJornadas({ perfil: 'leitura' }), false);
  assert.equal(podeEditarJornadas({ perfil: 'rh' }), true);
  assert.equal(podeEditarJornadas({ perfil: 'admin' }), true);
  assert.equal(podeEditarJornadas(null), true);   // legado sem perfil = administrador
});
