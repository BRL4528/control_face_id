// Usuários do RH: criar (com senha temporária gerada pelo servidor), desativar/
// reativar, e trocar a própria senha. Multi-tenant: o usuário novo nasce SEMPRE
// na empresa do RH autenticado — nunca cross-tenant.
//
// A senha nunca trafega em texto em NENHUM caminho:
//   • criar  → servidor gera a senha, deriva PBKDF2-SHA256 (mesmo formato do
//     navegador: 150k iter, 256 bits, HEX) e guarda só o bcrypt. Devolve a senha
//     UMA vez ao RH criador (para repassar). Nasce com trocar_senha=true.
//   • redefinir_senha → mesma geração, para outro usuário da empresa (esqueceu ou
//     não anotou a temporária). Também devolve a senha UMA vez.
//   • trocar → o cliente deriva a chave nova no navegador e envia só a chave. Fora
//     do fluxo de senha temporária exige também a chave ATUAL (chave_atual, derivada
//     com o sal/iterações de hoje): um token de 12 h não basta para tomar a conta.
//
// Sessões: o JWT do RH leva um carimbo do chave_hash (api/_lib/auth.js). Trocar ou
// redefinir a senha muda o hash e derruba as sessões abertas daquele usuário. Na
// troca da própria senha a resposta traz `token` novo, que o painel passa a usar
// (o token com que ele chamou já não vale).
//
// Perfil (acao 'criar' e 'acesso'): um de js/acessos.js. Sem perfil no 'criar', o
// usuário nasce 'leitura' (o mais restrito), nunca administrador. gestor_obra exige
// obras, e só valem equipes ATIVAS desta empresa.
import bcrypt from 'bcryptjs';
import { db, novoId } from '../_lib/db.js';
import { autenticarRh, emitirTokenRh } from '../_lib/auth.js';
import { acessoDe, exigeAcesso } from '../_lib/acesso.js';
import { comTabelaNova } from '../_lib/tabela-nova.js';
import { PERFIS } from '../../js/acessos.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';
import { ITER, novaSenhaTemporaria } from '../_lib/senha-rh.js';
import { idsDaEmpresa, listaDeIds } from '../_lib/validar.js';

export const PERFIL_PADRAO_NOVO = 'leitura';

/**
 * Perfil e obras pedidos, já conferidos. `obrasValidas` = Set das equipes ativas
 * da empresa (só é consultado para gestor_obra). Devolve { perfil, obras } ou
 * { erro }. Obra de fora da empresa, inexistente ou desativada é descartada; se
 * não sobrar nenhuma, é erro.
 */
export function perfilPedido(b, obrasValidas, padrao) {
  const perfil = b.perfil == null || b.perfil === '' ? padrao : b.perfil;
  if (!PERFIS[perfil]) return { erro: 'perfil inválido' };
  if (perfil !== 'gestor_obra') return { perfil, obras: null };
  const pedidas = Array.isArray(b.obras) ? listaDeIds(b.obras).slice(0, 200) : [];
  const obras = pedidas.filter(id => obrasValidas && obrasValidas.has(id));
  if (!obras.length) return { erro: pedidas.length ? 'escolha obras válidas da empresa' : 'escolha as obras do gestor' };
  return { perfil, obras };
}

/** Equipes ativas da empresa entre as obras pedidas (só para gestor_obra). */
async function obrasDaEmpresa(sql, b, empresaId) {
  const perfil = b.perfil;
  if (perfil !== 'gestor_obra' || !Array.isArray(b.obras)) return new Set();
  return idsDaEmpresa(sql, 'equipe', listaDeIds(b.obras).slice(0, 200), empresaId, { ativos: true });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const acao = b.acao || 'criar';
  // Trocar a própria senha vale para qualquer perfil; o resto é de administrador.
  if (acao !== 'trocar_senha' && !(await exigeAcesso(res, sql, rh, 'config', true))) return;

  // Perfil de acesso e obras (gestor de obra) de OUTRO usuário da mesma empresa.
  if (acao === 'acesso') {
    if (!b.usuario_id) return erro(res, 400, 'CORPO_INVALIDO', 'usuario_id obrigatório');
    if (b.usuario_id === rh.sub) return erro(res, 400, 'PROIBIDO', 'não é possível mudar o próprio perfil');
    if (!PERFIS[b.perfil]) return erro(res, 400, 'CORPO_INVALIDO', 'perfil inválido');
    const p = perfilPedido(b, await obrasDaEmpresa(sql, b, rh.empresa_id), null);
    if (p.erro) return erro(res, 400, 'CORPO_INVALIDO', p.erro);
    return comTabelaNova(res, async () => {
      const r = await sql`UPDATE usuario_rh SET perfil=${p.perfil}, obras=${p.obras ? JSON.stringify(p.obras) : null}::jsonb
                          WHERE id=${b.usuario_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
      if (!r[0]) return erro(res, 404, 'USUARIO_NAO_ENCONTRADO', 'usuário não encontrado');
      return ok(res, { usuario_id: b.usuario_id, perfil: p.perfil, obras: p.obras });
    });
  }

  // Desativar / reativar um usuário da MESMA empresa (e nunca a si mesmo, p/ não se trancar fora).
  if (acao === 'ativar' || acao === 'desativar') {
    if (!b.usuario_id) return erro(res, 400, 'CORPO_INVALIDO', 'usuario_id obrigatório');
    if (b.usuario_id === rh.sub) return erro(res, 400, 'PROIBIDO', 'não é possível desativar o próprio usuário');
    const r = await sql`UPDATE usuario_rh SET ativo=${acao === 'ativar'}
                        WHERE id=${b.usuario_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'USUARIO_NAO_ENCONTRADO', 'usuário não encontrado');
    return ok(res, { usuario_id: b.usuario_id, ativo: acao === 'ativar' });
  }

  // Redefinir a senha de OUTRO usuário da mesma empresa (esqueceu, ou a senha temporária
  // não foi anotada): gera uma nova temporária, mostrada UMA vez, e exige troca no próximo login.
  if (acao === 'redefinir_senha') {
    if (!b.usuario_id) return erro(res, 400, 'CORPO_INVALIDO', 'usuario_id obrigatório');
    if (b.usuario_id === rh.sub) return erro(res, 400, 'PROIBIDO', 'para trocar a própria senha, use a troca de senha do seu acesso');
    const alvo = await sql`SELECT usuario, nome FROM usuario_rh WHERE id=${b.usuario_id} AND empresa_id=${rh.empresa_id} LIMIT 1`;
    if (!alvo[0]) return erro(res, 404, 'USUARIO_NAO_ENCONTRADO', 'usuário não encontrado');
    const nova = await novaSenhaTemporaria();
    // chave_hash novo: as sessões abertas desse usuário caem (carimbo do JWT).
    const r = await sql`UPDATE usuario_rh SET sal=${nova.sal}, iteracoes=${ITER}, chave_hash=${nova.chaveHash}, trocar_senha=true
                        WHERE id=${b.usuario_id} AND empresa_id=${rh.empresa_id} RETURNING id`;
    if (!r[0]) return erro(res, 404, 'USUARIO_NAO_ENCONTRADO', 'usuário não encontrado');
    return ok(res, { usuario_id: b.usuario_id, usuario: alvo[0].usuario, nome: alvo[0].nome, senha_temporaria: nova.senha });
  }

  // Trocar a própria senha. O cliente já derivou a chave nova; guardamos o bcrypt
  // e zeramos trocar_senha. Usuário desativado não troca (o JWT vale 12 h, mas o
  // banco manda). Fora do fluxo de senha temporária, exige a chave atual.
  if (acao === 'trocar_senha') {
    if (!b.chave_nova || !b.sal_novo) return erro(res, 400, 'CORPO_INVALIDO', 'chave_nova e sal_novo obrigatórios');
    if (!(await acessoDe(sql, rh))) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
    const [u] = await sql`SELECT chave_hash, trocar_senha FROM usuario_rh
                          WHERE id=${rh.sub} AND empresa_id=${rh.empresa_id} AND ativo=true LIMIT 1`;
    if (!u) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
    if (!u.trocar_senha) {
      const confere = typeof b.chave_atual === 'string' && b.chave_atual && await bcrypt.compare(b.chave_atual, u.chave_hash);
      if (!confere) return erro(res, 401, 'SENHA_ATUAL_INVALIDA', 'senha atual não confere');
    }
    const hash = await bcrypt.hash(b.chave_nova, 10);
    const r = await sql`UPDATE usuario_rh SET chave_hash=${hash}, sal=${b.sal_novo}, iteracoes=${ITER}, trocar_senha=false
                        WHERE id=${rh.sub} AND empresa_id=${rh.empresa_id} AND ativo=true RETURNING id`;
    if (!r[0]) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
    // O token desta chamada caiu junto com a senha velha: devolve um novo.
    const token = emitirTokenRh({ id: rh.sub, empresa_id: rh.empresa_id, usuario: rh.usuario, nome: rh.nome, chave_hash: hash });
    return ok(res, { trocado: true, token });
  }

  // Criar: gera senha temporária, deriva e guarda o bcrypt.
  const usuario = String(b.usuario || '').trim().toLowerCase();
  const nome = String(b.nome || '').trim();
  if (!usuario || !nome) return erro(res, 400, 'CORPO_INVALIDO', 'usuario e nome obrigatórios');
  if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) return erro(res, 400, 'CORPO_INVALIDO', 'usuário: de 3 a 32 letras, números ou . _ -');
  // Perfil: o mesmo crivo da acao 'acesso'; sem perfil, o mais restrito.
  const p = perfilPedido(b, await obrasDaEmpresa(sql, b, rh.empresa_id), PERFIL_PADRAO_NOVO);
  if (p.erro) return erro(res, 400, 'CORPO_INVALIDO', p.erro);

  // Único no sistema inteiro (o login não pede empresa) — ver ux_usuario_rh_usuario.
  const jaExiste = await sql`SELECT 1 FROM usuario_rh WHERE lower(usuario)=${usuario} LIMIT 1`;
  if (jaExiste.length) return erro(res, 409, 'USUARIO_EXISTE', 'já existe um usuário com esse login');

  const { senha, sal, chaveHash } = await novaSenhaTemporaria();
  const id = novoId();
  return comTabelaNova(res, async () => {
    await sql`
      INSERT INTO usuario_rh (id, empresa_id, usuario, nome, sal, iteracoes, chave_hash, trocar_senha, perfil, obras)
      VALUES (${id}, ${rh.empresa_id}, ${usuario}, ${nome}, ${sal}, ${ITER}, ${chaveHash}, ${true},
              ${p.perfil}, ${p.obras ? JSON.stringify(p.obras) : null}::jsonb)`;
    // A senha em texto sai UMA vez, só aqui, para o RH criador repassar.
    return ok(res, { usuario_id: id, usuario, perfil: p.perfil, obras: p.obras, senha_temporaria: senha });
  });
}
