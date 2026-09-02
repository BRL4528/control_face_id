// Login do RH em duas etapas, para a senha nunca trafegar:
//   1. O cliente pede o sal (GET-like via ?usuario) e deriva PBKDF2 da senha.
//   2. Envia a chave derivada; conferimos com bcrypt e emitimos um JWT.
//
// Usuário inexistente recebe um sal falso determinístico, para a rota não virar
// um oráculo de quais usuários existem.
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { db } from '../_lib/db.js';
import { emitirTokenRh } from '../_lib/auth.js';
import { cors, ok, erro, corpo } from '../_lib/http.js';

const ITER_PADRAO = 150000;

function salFalso(usuario) {
  // Determinístico por usuário+segredo: parece real e é estável entre chamadas.
  const seg = process.env.JWT_SECRET || 'dev';
  return createHash('sha256').update('sal:' + seg + ':' + usuario).digest('hex').slice(0, 32);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const sql = db();

  // Etapa 1 — pedir o sal.
  if (req.method === 'GET') {
    const usuario = String((req.query && req.query.usuario) || '').trim();
    if (!usuario) return erro(res, 400, 'CORPO_INVALIDO', 'usuario obrigatório');
    const us = await sql`SELECT sal, iteracoes FROM usuario_rh WHERE usuario = ${usuario} AND ativo = true LIMIT 1`;
    const u = us[0];
    return ok(res, { sal: u ? u.sal : salFalso(usuario), iteracoes: u ? u.iteracoes : ITER_PADRAO });
  }

  if (req.method !== 'POST') return erro(res, 405, 'METODO_INVALIDO', 'método não permitido');

  // Etapa 2 — conferir a chave derivada e emitir sessão.
  const { usuario, chave } = corpo(req);
  if (!usuario || !chave) return erro(res, 400, 'CORPO_INVALIDO', 'usuario e chave obrigatórios');

  const us = await sql`
    SELECT id, empresa_id, usuario, nome, chave_hash, trocar_senha FROM usuario_rh
    WHERE usuario = ${usuario} AND ativo = true LIMIT 1`;
  const u = us[0];
  const confere = u ? await bcrypt.compare(chave, u.chave_hash) : false;
  if (!confere) return erro(res, 401, 'CREDENCIAL_INVALIDA', 'usuário ou senha inválidos');

  // Emite a sessão mesmo com senha temporária: o cliente usa o token só para
  // chamar /rh/usuario (trocar_senha) antes de liberar o resto do painel.
  return ok(res, {
    token: emitirTokenRh(u),
    trocar_senha: !!u.trocar_senha,
    usuario: { id: u.id, nome: u.nome, usuario: u.usuario, empresa_id: u.empresa_id }
  });
}
