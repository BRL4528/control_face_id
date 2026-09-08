// Usuários do RH: criar (com senha temporária gerada pelo servidor), desativar/
// reativar, e trocar a própria senha. Multi-tenant: o usuário novo nasce SEMPRE
// na empresa do RH autenticado — nunca cross-tenant.
//
// A senha nunca trafega em texto em NENHUM caminho:
//   • criar  → servidor gera a senha, deriva PBKDF2-SHA256 (mesmo formato do
//     navegador: 150k iter, 256 bits, HEX) e guarda só o bcrypt. Devolve a senha
//     UMA vez ao RH criador (para repassar). Nasce com trocar_senha=true.
//   • trocar → o cliente deriva a chave nova no navegador e envia só a chave.
import bcrypt from 'bcryptjs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { db, novoId } from '../_lib/db.js';
import { autenticarRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo, exigeMetodo } from '../_lib/http.js';

const ITER = 150000;
const derivarHex = (senha, salHex) =>
  pbkdf2Sync(senha, Buffer.from(salHex, 'hex'), ITER, 32, 'sha256').toString('hex');

// Senha temporária legível mas forte: 12 chars de um alfabeto sem ambíguos.
function senhaTemporaria() {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alf[b[i] % alf.length];
  return s;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (exigeMetodo(req, res, 'POST')) return;
  const rh = autenticarRh(req);
  if (!rh) return erro(res, 401, 'SESSAO_INVALIDA', 'faça login novamente');
  const b = corpo(req);
  const sql = db();
  const acao = b.acao || 'criar';

  // Desativar / reativar um usuário da MESMA empresa (e nunca a si mesmo, p/ não se trancar fora).
  if (acao === 'ativar' || acao === 'desativar') {
    if (!b.usuario_id) return erro(res, 400, 'CORPO_INVALIDO', 'usuario_id obrigatório');
    if (b.usuario_id === rh.sub) return erro(res, 400, 'PROIBIDO', 'não é possível desativar o próprio usuário');
    await sql`UPDATE usuario_rh SET ativo=${acao === 'ativar'}
              WHERE id=${b.usuario_id} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { usuario_id: b.usuario_id, ativo: acao === 'ativar' });
  }

  // Trocar a própria senha (usada no fluxo de senha temporária). O cliente já
  // derivou a chave nova; guardamos o bcrypt e zeramos trocar_senha.
  if (acao === 'trocar_senha') {
    if (!b.chave_nova || !b.sal_novo) return erro(res, 400, 'CORPO_INVALIDO', 'chave_nova e sal_novo obrigatórios');
    const hash = await bcrypt.hash(b.chave_nova, 10);
    await sql`UPDATE usuario_rh SET chave_hash=${hash}, sal=${b.sal_novo}, iteracoes=${ITER}, trocar_senha=false
              WHERE id=${rh.sub} AND empresa_id=${rh.empresa_id}`;
    return ok(res, { trocado: true });
  }

  // Criar: gera senha temporária, deriva e guarda o bcrypt.
  const usuario = String(b.usuario || '').trim().toLowerCase();
  const nome = String(b.nome || '').trim();
  if (!usuario || !nome) return erro(res, 400, 'CORPO_INVALIDO', 'usuario e nome obrigatórios');
  if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) return erro(res, 400, 'CORPO_INVALIDO', 'usuário: 3–32 letras/números/._-');

  // Único no sistema inteiro (o login não pede empresa) — ver ux_usuario_rh_usuario.
  const jaExiste = await sql`SELECT 1 FROM usuario_rh WHERE lower(usuario)=${usuario} LIMIT 1`;
  if (jaExiste.length) return erro(res, 409, 'USUARIO_EXISTE', 'já existe um usuário com esse login');

  const senha = senhaTemporaria();
  const sal = randomBytes(16).toString('hex');
  const chaveHash = await bcrypt.hash(derivarHex(senha, sal), 10);
  const id = novoId();
  await sql`
    INSERT INTO usuario_rh (id, empresa_id, usuario, nome, sal, iteracoes, chave_hash, trocar_senha)
    VALUES (${id}, ${rh.empresa_id}, ${usuario}, ${nome}, ${sal}, ${ITER}, ${chaveHash}, ${true})`;

  // A senha em texto sai UMA vez, só aqui, para o RH criador repassar.
  return ok(res, { usuario_id: id, usuario, senha_temporaria: senha });
}
